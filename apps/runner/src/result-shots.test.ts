import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { AgentUser } from './agent-user';
import { AppCodeBase } from './app-code-base';
import { CompareCheck } from './compare-check';
import { Json } from './json';
import type { RunEvent } from './progress';
import { ResultShots } from './result-shots';
import { ShotBrowser } from './shot-browser';
import { ShotBundle } from './shot-bundle';
import { ShotSite } from './shot-site';

// 결과 화면 찍기 (2026-11-28): 묶음 모으기 · 127.0.0.1 서버 · 실제 Chromium으로 찍기 · 기계 검사 · 참고 화면과 비교.
// Chromium이 없는 컴퓨터에서는 찍는 테스트를 건너뛴다 (MOIDA_SHOT_CHROMIUM 또는 /usr/bin/chromium · /opt/pw-browsers/chromium)

const agent = AgentUser.parse('self') as AgentUser;
const noBrowser = ShotBrowser.chromium() === null;
const DESIGN = [
  '# 성수 나들이',
  '## 한 줄',
  '걸어서 도는 하루 코스',
  '## 참고한 곳',
  '- https://example.com/a',
  '- https://example.com/b',
  '## 방향',
  '목록 먼저',
  '## 토큰',
  '--accent: #2563eb',
].join('\n');
const COMPARED = `${DESIGN}\n## 비교\n- 가져온 것: 목록 먼저 · 왼쪽 지도\n- 다른 점: 칩을 위로\n- 고친 것: 폰에서 지도 높이`;

/** 작업 자리(self)를 만들고 outputs에 파일을 둔다 */
async function room(files: Readonly<Record<string, string>>) {
  const workDir = await mkdtemp(join(tmpdir(), 'moida-shots-'));
  const outputs = join(workDir, 'outputs');
  await mkdir(outputs);
  for (const [name, body] of Object.entries(files)) await writeFile(join(outputs, name), body);
  const made = (await agent.list(outputs)) ?? [];
  const env = () => ({ PATH: '/usr/local/bin:/usr/bin:/bin', HOME: workDir, TMPDIR: workDir });
  return { workDir, outputs, made, place: { workDir, env } };
}

function app(files: { name: string; text: string | null }[]): AppCodeBase {
  const body = {
    app_id: 'a1',
    name: '나들이',
    kind: 'page',
    slug: 'walk',
    seq: 3,
    hosts: [],
    library: [],
  };
  const listed = files.map((f) => ({ name: f.name, size: f.text?.length ?? 10, text: f.text }));
  const code = AppCodeBase.from(Json.of({ ...body, files: listed }));
  assert.ok(code);
  return code;
}

describe('결과 화면의 서버 (ShotSite)', () => {
  test('주소의 경로를 묶음 안의 이름으로: 폴더는 index.html, 쿼리 · 조각은 뗀다', () => {
    assert.equal(ShotSite.nameOf('/'), 'index.html');
    assert.equal(ShotSite.nameOf('/posts/?a=1#b'), 'posts/index.html');
    assert.equal(ShotSite.nameOf('/%ED%95%9C.html'), '한.html');
    assert.equal(ShotSite.nameOf('/%E0%A4%A'), '');
  });

  test('묶음의 파일 · 예시 moida.js · 내용 없는 그림만 답하고 나머지는 404', async () => {
    const site = await ShotSite.open(
      new Map([['index.html', Buffer.from('<p>안녕</p>')]]),
      new Set(['logo.png']),
    );
    try {
      assert.match(site.origin, /^http:\/\/127\.0\.0\.1:\d+$/);
      const page = await fetch(`${site.origin}/`);
      assert.equal(page.headers.get('content-type'), 'text/html; charset=utf-8');
      assert.equal(await page.text(), '<p>안녕</p>');
      assert.match(await (await fetch(`${site.origin}/_/moida.js`)).text(), /window\.moida/);
      assert.match(await (await fetch(`${site.origin}/_/cairn.js`)).text(), /window\.moida/);
      const logo = await fetch(`${site.origin}/logo.png`);
      assert.equal([logo.status, logo.headers.get('content-type')].join(' '), '200 image/png');
      assert.equal((await fetch(`${site.origin}/../etc/passwd`)).status, 404);
    } finally {
      await site.close();
    }
  });
});

describe('찍을 묶음 (ShotBundle)', () => {
  test('템플릿으로 그리는 앱은 찍지 않고 까닭을 남긴다. 정적 앱은 앞 버전 위에 낸 파일을 얹는다', async () => {
    const r = await room({ 'list.html': '{{#posts}}{{title}}{{/posts}}' });
    try {
      const template = await ShotBundle.gather(agent, r.outputs, r.made, {
        app: app([{ name: 'index.html', text: '<p>{{name}}</p>' }]),
      });
      assert.equal(template.entry, null);
      assert.match(template.skip ?? '', /템플릿/);
      const fixed = await ShotBundle.gather(agent, r.outputs, r.made, {
        app: app([
          { name: 'moida.json', text: '{"render":"static"}' },
          { name: 'index.html', text: '<p>앞</p>' },
          { name: 'photo.jpg', text: null },
        ]),
      });
      assert.equal(fixed.entry, 'index.html');
      assert.deepEqual([...fixed.files.keys()].sort(), ['index.html', 'list.html', 'moida.json']);
      assert.deepEqual([...fixed.known], ['photo.jpg']);
      assert.equal(fixed.screens, true);
    } finally {
      await rm(r.workDir, { recursive: true, force: true });
    }
  });

  test('페이지도 앱도 아닌 일은 낸 HTML이 있을 때만 (index.html, 없으면 이름순 첫 .html)', async () => {
    const r = await room({ 'b-slides.html': '<h1>둘</h1>', 'a-deck.html': '<h1>하나</h1>' });
    const none = await room({ '보고서.md': '# 보고서' });
    try {
      const slides = await ShotBundle.gather(agent, r.outputs, r.made, null);
      assert.deepEqual([slides.entry, slides.skip, slides.screens], ['a-deck.html', null, true]);
      const md = await ShotBundle.gather(agent, none.outputs, none.made, null);
      assert.deepEqual([md.entry, md.skip, md.screens], [null, null, false]);
    } finally {
      await rm(r.workDir, { recursive: true, force: true });
      await rm(none.workDir, { recursive: true, force: true });
    }
  });
});

describe('참고 화면과 비교 (CompareCheck)', () => {
  const shots = ['/w/.moida/shots/desktop.png', '/w/.moida/shots/phone.png'];
  test('앱은 design.md의 ## 비교에 셋을 모두, 참고 화면은 .moida/refs/에 하나 이상', () => {
    const missing = CompareCheck.check(DESIGN, true, 0, shots, 'design.md의 "## 비교"');
    assert.deepEqual([missing.ok, missing.how], [false, '2개']);
    assert.match(missing.tail, /desktop\.png · \/w\/\.moida\/shots\/phone\.png/);
    assert.match(missing.tail, /\.moida\/refs\/에 참고 화면이 없어요/);
    assert.match(missing.tail, /"비교" 제목\(둘째 단계\)이 없어요/);
    const half = CompareCheck.check(
      `${DESIGN}\n## 비교\n가져온 것: 목록\n## 덧붙임\n다른 점 고친 것`,
      true,
      1,
      shots,
      'x',
    );
    assert.match(half.tail, /"다른 점"이 없어요/);
    assert.match(half.tail, /"고친 것"이 없어요/);
    const ok = CompareCheck.check(COMPARED, true, 2, shots, 'x');
    assert.deepEqual([ok.ok, ok.how, ok.tail], [true, '참고 2개', '']);
  });

  test('페이지는 compare.md에 셋을', () => {
    assert.match(
      CompareCheck.check(null, false, 1, shots, '/w/.moida/compare.md').tail,
      /compare\.md가 없어요/,
    );
    const ok = CompareCheck.check('가져온 것 · 다른 점 · 고친 것', false, 1, shots, 'x');
    assert.equal(ok.ok, true);
  });
});

describe('결과 화면 찍기 (ResultShots, 실제 Chromium)', { skip: noBrowser }, () => {
  /** 찍고 검사한다. 남긴 알림도 함께 */
  async function shoot(files: Readonly<Record<string, string>>, base: AppCodeBase | null = null) {
    const r = await room(files);
    const notes: RunEvent[] = [];
    const bundle = await ShotBundle.gather(agent, r.outputs, r.made, base ? { app: base } : null);
    const checks = await new ResultShots(agent, r.place).checks(
      bundle,
      new AbortController().signal,
      (e) => notes.push(e),
    );
    return { r, checks, notes };
  }

  test('정적 지도 앱: 부품 · 지도 자리가 그려지고 데스크톱 · 폰 그림이 남는다. 비교가 없으면 떨어지고, 적으면 지난다', async () => {
    const files = {
      'moida.json': '{"render":"static"}',
      'index.html':
        '<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>성수</title><script src="_/moida.js" defer></script></head><body><h1>성수 나들이</h1><moida-place-list src="places.json"></moida-place-list></body></html>',
      'places.json': JSON.stringify([
        { name: '카페 하나', category: '카페', address: '서울 성동구 1' },
      ]),
      'design.md': DESIGN,
    };
    const first = await shoot(files, app([]));
    try {
      const [screen, compare] = first.checks;
      assert.deepEqual(
        [screen?.name, screen?.ok, screen?.how],
        ['결과 화면', true, '데스크톱 · 폰'],
      );
      assert.deepEqual([compare?.name, compare?.ok], ['참고 화면과 비교', false]);
      for (const name of ['desktop', 'phone'])
        assert.ok((await stat(join(first.r.workDir, ResultShots.DIR, `${name}.png`))).size > 1000);
      assert.ok(first.notes.some((n) => /결과 화면을 찍었어요/.test(n.body)));
    } finally {
      await rm(first.r.workDir, { recursive: true, force: true });
    }
    const second = await shoot({ ...files, 'design.md': COMPARED }, app([]));
    try {
      await mkdir(join(second.r.workDir, CompareCheck.REFS), { recursive: true });
      await writeFile(join(second.r.workDir, CompareCheck.REFS, 'a.md'), '배치 · 색');
      const again = await new ResultShots(agent, second.r.place).checks(
        await ShotBundle.gather(agent, second.r.outputs, second.r.made, { app: app([]) }),
        new AbortController().signal,
        () => {},
      );
      assert.deepEqual(
        again.map((c) => [c.name, c.ok]),
        [
          ['결과 화면', true],
          ['참고 화면과 비교', true],
        ],
      );
    } finally {
      await rm(second.r.workDir, { recursive: true, force: true });
    }
  });

  test('잡히지 않은 오류 · 폰 폭의 가로 넘침 · 빈 지도 자리 · 없는 파일을 짚는다. 바깥 요청은 막는다', async () => {
    const { r, checks } = await shoot({
      'index.html': [
        '<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1">',
        '<link rel="stylesheet" href="https://fonts.example.com/x.css"><script src="_/moida.js"></script>',
        '<h1>넓은 표</h1><div class="wide" style="width:700px">넓다</div><div id="map" style="height:0"></div>',
        '<img src="없는.png"><script>moida.map.create("#map", { places: [] }); null.boom;</script>',
      ].join(''),
    });
    try {
      const [screen] = checks;
      assert.equal(screen?.ok, false);
      const tail = screen?.tail ?? '';
      assert.match(tail, /오류: .*null/);
      assert.match(tail, /폰\(390px\): 가로로 \d+px 넘쳐요 \(넘치는 요소: div\.wide/);
      assert.match(tail, /비어 있는 부품 · 지도 자리 div#map \(지도 자리의 크기가 \d+×0\)/);
      assert.match(tail, /묶음에 없는 파일을 불러요: \/%EC%97%86%EB%8A%94\.png/);
      assert.doesNotMatch(tail, /fonts\.example\.com/);
    } finally {
      await rm(r.workDir, { recursive: true, force: true });
    }
  });

  test('빈 화면을 짚는다 (HTML을 냈으니 비교도 묻는다)', async () => {
    const { r, checks } = await shoot({ 'index.html': '<!doctype html><body></body>' });
    try {
      assert.match(checks[0]?.tail ?? '', /빈 화면이에요/);
      assert.equal(checks.length, 2);
    } finally {
      await rm(r.workDir, { recursive: true, force: true });
    }
  });

  test('Chromium을 끄면(MOIDA_SHOT_CHROMIUM=off) 찍지 않고 알림만 남긴다', async () => {
    process.env.MOIDA_SHOT_CHROMIUM = 'off';
    try {
      const { r, checks, notes } = await shoot({ 'index.html': '<p>문</p>' });
      await rm(r.workDir, { recursive: true, force: true });
      assert.deepEqual(checks, []);
      assert.match(notes[0]?.body ?? '', /Chromium이 없어 결과 화면을 찍지 않았어요/);
    } finally {
      delete process.env.MOIDA_SHOT_CHROMIUM;
    }
  });
});
