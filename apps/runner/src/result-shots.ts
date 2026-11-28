import { join } from 'node:path';
import type { AgentUser } from './agent-user';
import { CompareCheck } from './compare-check';
import { RunEvent } from './progress';
import { ShotBrowser, type ShotView } from './shot-browser';
import type { ShotBundle } from './shot-bundle';
import { ShotSite } from './shot-site';
import { StageCheck } from './stage-check';

// 결과 화면 찍기 (2026-11-28, 검증 고리 V의 만들기 작업 검사). AI 없이 러너가 한다:
//   묶음(ShotBundle)을 127.0.0.1에 띄우고(ShotSite, _/moida.js는 예시 데이터) → 데스크톱 · 폰으로 찍고(ShotBrowser, agent 권한)
//   → 기계로 볼 수 있는 것을 본다: 잡히지 않은 오류 · 콘솔 오류, 빈 화면, 폰 폭의 가로 넘침, 빈 부품 · 지도 자리, 없는 파일.
//   → 이번에 화면을 냈으면 참고 화면과의 비교(CompareCheck)도.
// 떨어지면 JobRun이 찍은 그림의 경로를 실은 글로 AI에게 한 번 더 맡긴다 (틀 check-fix). Chromium · Playwright가 없거나
// 브라우저를 띄우지 못하면 찍지 않고 실행 기록에 적기만 한다 (일을 실패로 끝내지 않는다)
export class ResultShots {
  static readonly DIR = '.moida/shots';
  private static readonly SHOWN = 6;
  private static readonly VIEW: Readonly<Record<string, string>> = {
    desktop: '데스크톱(1280px)',
    phone: '폰(390px)',
  };

  constructor(
    private readonly agent: AgentUser,
    private readonly room: { workDir: string; env(): Record<string, string> },
  ) {}

  /** 찍고 검사한다. 찍지 않았으면 빈 목록 (까닭은 note로) */
  async checks(
    bundle: ShotBundle,
    signal: AbortSignal,
    note: (event: RunEvent) => void,
  ): Promise<StageCheck[]> {
    if (bundle.skip !== null) note(new RunEvent(RunEvent.READ, bundle.skip, 0));
    if (bundle.entry === null) return [];
    const chromium = ShotBrowser.chromium();
    const playwright = await ShotBrowser.playwright();
    if (chromium === null || playwright === null) {
      note(new RunEvent(RunEvent.READ, '이 러너에 Chromium이 없어 결과 화면을 찍지 않았어요', 0));
      return [];
    }
    const site = await ShotSite.open(bundle.files, bundle.known);
    const shotDir = join(this.room.workDir, ResultShots.DIR);
    let views: readonly ShotView[] | string;
    try {
      const url = `${site.origin}/${bundle.entry.split('/').map(encodeURIComponent).join('/')}`;
      views = await new ShotBrowser(this.agent, chromium, playwright).take(
        url,
        shotDir,
        this.room,
        signal,
      );
    } finally {
      await site.close();
    }
    if (typeof views === 'string') {
      note(new RunEvent(RunEvent.ERROR, `결과 화면을 찍지 못했어요: ${views}`, 0));
      return [];
    }
    const paths = views.map((v) => v.path);
    note(new RunEvent(RunEvent.RESULT, `결과 화면을 찍었어요: ${paths.join(' · ')}`, 0));
    const checks = [ResultShots.screenCheck(views, paths)];
    if (bundle.screens) checks.push(await this.compareCheck(bundle, paths));
    return checks;
  }

  /** 기계로 본 문제들. 같은 문제가 두 크기에서 나면 한 번만 */
  static problems(views: readonly ShotView[]): string[] {
    const found = new Set<string>();
    const add = (text: string) => found.add(text);
    for (const v of views) {
      const at = ResultShots.VIEW[v.name] ?? v.name;
      if (v.loadError !== null) add(`${at}: 열지 못했어요 (${v.loadError})`);
      for (const e of v.errors) add(e);
      if (v.loadError === null && v.blank)
        add(`${at}: 빈 화면이에요 (보이는 글자 · 그림이 없어요)`);
      if (v.name === 'phone' && v.overflow > 2)
        add(`${at}: 가로로 ${v.overflow}px 넘쳐요 (넘치는 요소: ${v.wide.join(', ') || '모름'})`);
      for (const e of v.empty) add(`${at}: 비어 있는 부품 · 지도 자리 ${e}`);
      for (const m of v.missing) add(`묶음에 없는 파일을 불러요: ${m}`);
    }
    return [...found];
  }

  private static screenCheck(views: readonly ShotView[], paths: readonly string[]): StageCheck {
    const problems = ResultShots.problems(views);
    const ok = problems.length === 0;
    const shown = problems.slice(0, ResultShots.SHOWN);
    const more = problems.length - shown.length;
    return StageCheck.seen(
      '결과 화면',
      ok,
      ok ? '데스크톱 · 폰' : `문제 ${problems.length}개`,
      [
        `러너가 결과 화면을 찍어 봤어요 (moida.js는 예시 데이터, 바깥 주소로 나가는 요청은 막음): ${paths.join(' · ')}.`,
        '그림을 열어 보고 아래를 고쳐요. 바깥 글꼴 · 지도 SDK가 막혀 생긴 차이는 고치지 않아도 돼요',
        ...shown.map((p) => `- ${p}`),
        ...(more > 0 ? [`- 그 밖에 ${more}개`] : []),
      ].join('\n'),
    );
  }

  private async compareCheck(bundle: ShotBundle, paths: readonly string[]): Promise<StageCheck> {
    const refs = (await this.agent.list(join(this.room.workDir, CompareCheck.REFS))) ?? [];
    const count = refs.filter((e) => e.file).length;
    if (bundle.app)
      return CompareCheck.check(bundle.designDoc, true, count, paths, 'design.md의 "비교" 단락');
    const note = join(this.room.workDir, CompareCheck.NOTE);
    const text = await this.agent.readFile(note, 64 * 1024);
    return CompareCheck.check(text, false, count, paths, note);
  }
}
