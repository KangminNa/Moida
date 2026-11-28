import { existsSync } from 'node:fs';
import { realpath } from 'node:fs/promises';
import type { AgentUser } from './agent-user';
import { IntegrationExec } from './integration-exec';
import { Json } from './json';

/** 한 화면 크기에서 본 것 (찍기 스크립트의 답 한 칸) */
export class ShotView {
  constructor(
    /** desktop · phone */
    readonly name: string,
    /** 찍은 그림의 경로 (작업 자리 안) */
    readonly path: string,
    /** 잡히지 않은 오류 · 콘솔 오류 (앞의 몇 개) */
    readonly errors: readonly string[],
    /** 열지 못한 까닭 (열었으면 null) */
    readonly loadError: string | null,
    /** 보이는 글자 수 · 그림(img · svg · canvas · video · iframe) 수 */
    readonly text: number,
    readonly media: number,
    /** 화면보다 넓은 만큼(px)과 넘치는 요소 */
    readonly overflow: number,
    readonly wide: readonly string[],
    /** 비어 있는 부품 · 지도 자리 */
    readonly empty: readonly string[],
    /** 이 묶음에 없는 파일 (404) */
    readonly missing: readonly string[],
  ) {}

  get blank(): boolean {
    return this.text === 0 && this.media === 0;
  }
}

// 결과 화면 찍기의 브라우저 (2026-11-28). Playwright(러너의 @playwright/mcp 안의 playwright-core)로 칸의 Chromium을 띄워
// 데스크톱(1280×800) · 폰(390×844) 두 크기로 연다. 스크립트는 agent로 돈다: AI가 만든 화면을 여는 것이라 러너의 권한으로 돌리지 않는다.
// 127.0.0.1의 그 주소 밖으로 나가는 요청은 모두 막고(바깥 글꼴 · 지도 SDK · 분석 스크립트) 센다. 그림은 작업 자리의 .moida/shots/에.
// Chromium이 없으면(러너 이미지 · 내 컴퓨터) null: 찍지 않고 넘어간다
export class ShotBrowser {
  static readonly VIEWS = [
    { name: 'desktop', width: 1280, height: 800, mobile: false },
    { name: 'phone', width: 390, height: 844, mobile: true },
  ] as const;
  private static readonly CANDIDATES = [
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/opt/pw-browsers/chromium',
  ];
  private static readonly TIMEOUT_MS = 90_000;
  private static readonly REPORT_MAX = 256 * 1024;

  /** 쓸 Chromium: MOIDA_SHOT_CHROMIUM(off면 찍지 않음), 없으면 흔한 자리. 못 찾으면 null */
  static chromium(env: NodeJS.ProcessEnv = process.env): string | null {
    const named = env.MOIDA_SHOT_CHROMIUM?.trim();
    if (named === 'off') return null;
    if (named) return existsSync(named) ? named : null;
    return ShotBrowser.CANDIDATES.find((path) => existsSync(path)) ?? null;
  }

  /** 러너가 가진 playwright-core의 자리. 없으면 null */
  static async playwright(): Promise<string | null> {
    try {
      return await realpath(IntegrationExec.playwrightCore());
    } catch {
      return null;
    }
  }

  constructor(
    private readonly agent: AgentUser,
    private readonly chromium: string,
    private readonly playwright: string,
  ) {}

  /** url을 두 크기로 열어 outDir에 찍는다. 스크립트가 돌지 못했으면 그 까닭(글), 아니면 두 화면 */
  async take(
    url: string,
    outDir: string,
    room: { workDir: string; env(): Record<string, string> },
    signal: AbortSignal,
  ): Promise<readonly ShotView[] | string> {
    const job = {
      playwright: this.playwright,
      chromium: this.chromium,
      url,
      origin: new URL(url).origin,
      outDir,
      views: ShotBrowser.VIEWS,
    };
    const out = await this.agent.exec(process.execPath, ['-e', SHOT_SCRIPT, JSON.stringify(job)], {
      cwd: room.workDir,
      env: room.env(),
      timeoutMs: ShotBrowser.TIMEOUT_MS,
      signal,
      stdoutMax: ShotBrowser.REPORT_MAX,
    });
    if (!out.ok || out.stdout === null) return `찍기 스크립트가 끝나지 못했어요 (${out.how})`;
    const body = Json.parse(out.stdout.toString('utf8'));
    if (body === null) return '찍기 스크립트의 답을 읽지 못했어요';
    const failed = body.optionalText('failed');
    if (failed !== null) return failed;
    return body
      .list('views')
      .map(
        (v) =>
          new ShotView(
            v.text('name'),
            v.text('path'),
            v.texts('errors'),
            v.optionalText('loadError'),
            v.number('text'),
            v.number('media'),
            v.number('overflow'),
            v.texts('wide'),
            v.texts('empty'),
            v.texts('missing'),
          ),
      );
  }
}

/** agent가 node -e로 돌리는 찍기 스크립트. argv[1]은 위 job의 JSON. 답은 표준 출력의 JSON 한 개 */
const SHOT_SCRIPT = String.raw`
const job = JSON.parse(process.argv[1]);
const fs = require('node:fs');
const path = require('node:path');
const cut = (s) => String(s).slice(0, 300);
// Chromium은 TMPDIR 아래에 소켓을 만든다: 작업 자리의 임시 폴더는 경로가 길어 소켓 이름 한도(108자)를 넘으니 /tmp의 짧은 폴더를 쓴다
let short = null;
try {
  short = fs.mkdtempSync('/tmp/moida-shot-');
  process.env.TMPDIR = short;
} catch {}
(async () => {
  const { chromium } = require(job.playwright);
  fs.mkdirSync(job.outDir, { recursive: true });
  const browser = await chromium.launch({
    executablePath: job.chromium,
    args: ['--no-sandbox', '--no-proxy-server', '--disable-gpu'],
  });
  const views = [];
  try {
    for (const v of job.views) {
      const context = await browser.newContext({
        viewport: { width: v.width, height: v.height },
        deviceScaleFactor: 1,
        isMobile: v.mobile,
        hasTouch: v.mobile,
        serviceWorkers: 'block',
        locale: 'ko-KR',
      });
      await context.route('**/*', (route) => {
        const url = route.request().url();
        return url === job.origin || url.startsWith(job.origin + '/') ? route.continue() : route.abort();
      });
      const page = await context.newPage();
      const errors = [];
      const missing = [];
      page.on('pageerror', (e) => errors.push('오류: ' + cut(e.message)));
      page.on('console', (m) => {
        if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) errors.push('콘솔: ' + cut(m.text()));
      });
      page.on('response', (r) => {
        if (r.status() >= 400 && r.url().startsWith(job.origin + '/')) missing.push(cut(new URL(r.url()).pathname));
      });
      let loadError = null;
      try {
        await page.goto(job.url, { waitUntil: 'load', timeout: 20000 });
        await page.waitForTimeout(1200);
      } catch (e) {
        loadError = cut(e.message);
      }
      // 폰 흉내에서는 넘치는 내용만큼 화면이 넓어지므로(축소해 보임) 정한 폭(v.width)과 비교한다
      const facts = await page.evaluate((width) => {
        const label = (n) => n.tagName.toLowerCase() + (n.id ? '#' + n.id : '') + (typeof n.className === 'string' && n.className.trim() ? '.' + n.className.trim().split(/\s+/).slice(0, 2).join('.') : '');
        const doc = document.documentElement;
        const body = document.body;
        const wide = [];
        for (const n of document.querySelectorAll('body *')) {
          const r = n.getBoundingClientRect();
          if (r.right > width + 1 && r.width > 0 && getComputedStyle(n).position !== 'fixed') wide.push(label(n) + ' (' + Math.round(r.right) + 'px)');
          if (wide.length >= 5) break;
        }
        const empty = [...((window.__moidaShot && window.__moidaShot.empty) || [])];
        for (const n of document.querySelectorAll('moida-place-list,moida-map,moida-account,moida-rows')) {
          const r = n.getBoundingClientRect();
          if (r.width < 4 || r.height < 4 || !n.firstElementChild) empty.push(label(n));
        }
        return {
          text: ((body && body.innerText) || '').trim().length,
          media: document.querySelectorAll('img,svg,canvas,video,iframe').length,
          overflow: Math.max(0, Math.max(doc.scrollWidth, body ? body.scrollWidth : 0) - width),
          wide,
          empty: empty.slice(0, 10),
        };
      }, v.width).catch((e) => ({ text: 0, media: 0, overflow: 0, wide: [], empty: [], failed: cut(e.message) }));
      const file = path.join(job.outDir, v.name + '.png');
      await page.screenshot({ path: file }).catch((e) => errors.push('찍기: ' + cut(e.message)));
      views.push({ name: v.name, path: file, errors: errors.slice(0, 8), loadError, missing: [...new Set(missing)].slice(0, 10), ...facts });
      await context.close();
    }
  } finally {
    await browser.close();
  }
  process.stdout.write(JSON.stringify({ views }));
})()
  .catch((e) => process.stdout.write(JSON.stringify({ failed: '브라우저를 띄우지 못했어요: ' + cut(e && e.message ? e.message : e) })))
  .finally(() => short && fs.rmSync(short, { recursive: true, force: true }));
`;
