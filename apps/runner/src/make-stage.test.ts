import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, test } from 'node:test';
import { AgentUser } from './agent-user';
import type { CairnServer } from './cairn-server';
import { ClaudeCli } from './claude-cli';
import { Job } from './job';
import { Json } from './json';
import { MakeMaterials, MakeStage } from './make-stage';
import { PageBase } from './page-base';
import { PromptPack } from './prompt-pack';
import { Redactor, RunLog } from './redactor';
import { RunnerConfig } from './runner-config';

// 만들기 작업의 재료 읽기 (서버가 걸렀어도 지시문 · 도구 입력에 쓰기 전에 다시 본다)와 일의 모양.

const id = (n: number) => `00000000-0000-7000-8000-${String(n).padStart(12, '0')}`;

describe('만들기 작업', () => {
  test('재료는 uuid만, 겹치지 않게, 10개까지', () => {
    const m = MakeMaterials.from({
      outputs: [id(1), id(1), '../x', 3, id(2)],
      wikis: Array.from({ length: 12 }, (_, i) => id(i + 10)),
    });
    assert.deepEqual(m.outputs, [id(1), id(2)]);
    assert.equal(m.wikis.length, 10);
    assert.deepEqual(MakeMaterials.from(null).outputs, []);
    assert.deepEqual(MakeMaterials.from({ outputs: 'x' }).outputs, []);
  });

  test('make 일은 칸의 일이고 payload.make를 들고 온다. 다른 일에는 없다', () => {
    const raw = (kind: string, payload: object) =>
      Json.parse(
        JSON.stringify({
          task: { id: id(99), kind, title: '발표', payload },
          agent: { name: '만들기', role: '', tool: 'claude' },
          instruction: '만들어 주세요',
          run_token: 'cairn_run_x',
        }),
      ) as Json;
    const make = Job.from(raw('make', { make: { outputs: [id(1)], wikis: [] } }));
    assert.equal(make.isMake && make.sandboxed && !make.isCode, true);
    assert.deepEqual(MakeMaterials.from(make.makePayload).outputs, [id(1)]);
    assert.equal(
      make.withBrief('# 재료').makePayload,
      make.makePayload,
      '단락을 더해도 재료는 그대로',
    );
    const general = Job.from(raw('general', { make: { outputs: [id(1)] } }));
    assert.equal(general.sandboxed, false);
    assert.equal(general.makePayload, null);
  });

  test('웹 검색은 작업 토큰이 있는 모든 일에 연다 (페이지 일 표시는 그대로 읽는다)', async () => {
    const raw = (payload: object) =>
      Json.parse(
        JSON.stringify({
          task: { id: id(98), kind: 'make', title: '데이트 코스', payload },
          agent: { name: '만들기', role: '', tool: 'claude' },
          instruction: '이번 주 서울 데이트 코스 짜 줘',
          run_token: 'cairn_run_x',
        }),
      ) as Json;
    const page = Job.from(raw({ page: { title: '서울 데이트 코스' } }));
    const plain = Job.from(raw({ make: { outputs: [], wikis: [] } }));
    assert.deepEqual([page.page, plain.page], [true, false]);
    assert.equal(page.withBrief('# 페이지').page, true, '단락을 더해도 그대로');
    const toolsOf = async (job: Job) => {
      const cli = new ClaudeCli(
        'claude',
        'oauth-token',
        'http://cairn-server:4000/mcp',
        '/nowhere',
      );
      const workspace = await cli.open(job);
      const args = [...cli.args(workspace)];
      await workspace.remove();
      return [args[args.indexOf('--tools') + 1], args.includes('WebSearch')];
    };
    assert.deepEqual(await toolsOf(page), ['Read,Write,Edit,WebSearch', true]);
    assert.deepEqual(await toolsOf(plain), ['Read,Write,Edit,WebSearch', true]);
    // 다른 종류의 일은 page를 적어도 페이지 일이 아니다. 웹 검색은 열린다
    const general = Job.from(
      Json.parse(
        JSON.stringify({
          task: { id: id(97), kind: 'general', title: '일', payload: { page: {} } },
          agent: { name: '일반', role: '', tool: 'claude' },
          instruction: '해 주세요',
          run_token: 'cairn_run_x',
        }),
      ) as Json,
    );
    assert.equal(general.page, false);
    assert.deepEqual(await toolsOf(general), ['Read,Write,Edit,WebSearch', true]);
    // 작업 토큰이 없는 일(연결 확인)은 도구가 없다
    const probe = Job.from(
      Json.parse(
        JSON.stringify({
          task: { id: id(96), kind: 'general', title: '일', payload: {} },
          agent: { name: '일반', role: '', tool: 'claude' },
          instruction: '해 주세요',
        }),
      ) as Json,
    );
    const cli = new ClaudeCli('claude', 'oauth-token', 'http://cairn-server:4000/mcp', '/nowhere');
    const workspace = await cli.open(probe);
    assert.equal(cli.args(workspace).includes('WebSearch'), false);
    await workspace.remove();
  });
});

describe('자라는 페이지의 지금 판 (page_base)', () => {
  const base = (body: object) => PageBase.from(Json.of(body));

  test('고칠 페이지가 없으면 null. 디스크에 쓰기 전에 파일 이름을 다시 본다', () => {
    assert.equal(base({ page_id: null, files: [] }), null);
    const page = base({
      page_id: id(5),
      title: '현황판',
      direction: '매주 채워요',
      seq: 3,
      files: [
        { name: 'index.html', text: '<p>3판</p>' },
        { name: '../up.html', text: 'x' },
        { name: '.hidden', text: 'x' },
        { name: 'a\nb', text: 'x' },
        { name: 'logo.png', text: null },
      ],
    });
    assert.ok(page);
    assert.deepEqual(
      page.files.map((f) => f.name),
      ['index.html', 'logo.png'],
    );
    assert.deepEqual([page.title, page.direction, page.seq], ['현황판', '매주 채워요', 3]);
    assert.match(page.listing, /^- index\.html\n- logo\.png \(그대로 남아요/);
  });

  test('글 파일만 inputs/page/에 쓰고, 지시문은 바뀐 파일만 내라고 알린다', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cairn-page-base-'));
    try {
      const page = base({
        page_id: id(6),
        title: '여행 지도',
        direction: '도시별로 묶어요',
        seq: 2,
        files: [
          { name: 'index.html', text: '<p>2판</p>' },
          { name: 'data.json', text: '{"a":1}' },
          { name: 'photo.jpg', text: null },
        ],
      });
      assert.ok(page);
      const into = await page.writeTo(dir);
      assert.equal(into, join(dir, 'page'));
      assert.deepEqual((await readdir(into)).sort(), ['data.json', 'index.html']);
      assert.equal(await readFile(join(into, 'index.html'), 'utf8'), '<p>2판</p>');

      const pack = PromptPack.read(resolve(__dirname, '../../../skills'));
      const growing = pack.fill('make', {
        page: true,
        base: into,
        baseTitle: page.title,
        baseSeq: page.seq,
        baseFiles: page.listing,
        direction: page.direction,
      });
      assert.match(growing, /# 고칠 페이지: 여행 지도 \(지금 버전 2\)/);
      assert.match(growing, /바뀐 파일만 결과물 폴더에 내요/);
      assert.match(growing, /## 이 페이지의 방향[^\n]*\n도시별로 묶어요/);
      assert.doesNotMatch(growing, /index\.html을 꼭/, '고치는 일은 문을 다시 내지 않아도 된다');
      const fresh = pack.fill('make', { page: true });
      assert.match(fresh, /index\.html을 꼭 만들어요/);
      assert.doesNotMatch(fresh, /고칠 페이지/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('만들기 작업의 검사 (검증 고리 V)', () => {
  const makeJob = (n: number, payload: object) =>
    Job.from(
      Json.parse(
        JSON.stringify({
          task: { id: id(n), kind: 'make', title: '발표', payload },
          agent: { name: '만들기', role: '', tool: 'claude' },
          instruction: '만들어 주세요',
          run_token: 'cairn_run_x',
        }),
      ) as Json,
    );
  /** 자리를 열고(self) 검사를 돌린다. made: AI가 outputs에 둔 것 */
  const checksOf = async (
    job: Job,
    made: (outputs: string) => Promise<void>,
    page: PageBase | null = null,
  ) => {
    const work = await mkdtemp(join(tmpdir(), 'cairn-make-check-'));
    const config = new RunnerConfig(
      'http://cairn',
      'device',
      null,
      'claude',
      '/없는',
      null,
      'codex',
      null,
      '1',
      AgentUser.parse('self'),
      work,
    );
    const server = { pageBase: async () => page } as unknown as CairnServer;
    const redactor = new Redactor([]);
    const stage = new MakeStage(
      job,
      config,
      AgentUser.parse('self') as AgentUser,
      new RunLog(redactor),
      server,
    );
    try {
      assert.equal(await stage.prepare(new AbortController().signal, () => {}, redactor), null);
      await made(stage.workspaceRoom?.outputsDir ?? '');
      return (await stage.check()).map((c) => ({
        name: c.name,
        ok: c.ok,
        how: c.how,
        tail: c.tail,
      }));
    } finally {
      await stage.close();
      await rm(work, { recursive: true, force: true });
    }
  };

  test('outputs 폴더 바로 아래에 올릴 파일이 있어야 한다 (폴더 · 숨김 파일 · 링크는 세지 않는다)', async () => {
    const plain = makeJob(90, { make: { outputs: [], wikis: [] } });
    const [empty] = await checksOf(plain, async (dir) => {
      await writeFile(join(dir, '.hidden'), 'x');
      await mkdir(join(dir, 'nested'));
      await writeFile(join(dir, 'nested', 'a.txt'), 'x');
      await symlink('/etc/hostname', join(dir, 'link.txt'));
    });
    assert.deepEqual([empty?.name, empty?.ok, empty?.how], ['결과물 파일', false, '없음']);
    assert.match(empty?.tail ?? '', /outputs 바로 아래에 둔 파일이 없어요/);
    const made = await checksOf(plain, async (dir) => {
      await writeFile(join(dir, '발표.pptx'), 'PK');
      await writeFile(join(dir, '메모.md'), '# 메모');
    });
    assert.deepEqual(made, [{ name: '결과물 파일', ok: true, how: '2개', tail: '' }]);
  });

  test('새 페이지는 문(index.html)도 본다. 고치는 페이지는 바뀐 파일만 내도 된다', async () => {
    const fresh = makeJob(91, { page: { title: '데이트 코스' } });
    const noDoor = await checksOf(fresh, (dir) => writeFile(join(dir, 'style.css'), 'p{}'));
    assert.deepEqual(
      noDoor.map((c) => [c.name, c.ok, c.how]),
      [
        ['결과물 파일', true, '1개'],
        ['index.html', false, '없음'],
      ],
    );
    assert.match(noDoor[1]?.tail ?? '', /index\.html가 문이에요/);
    const door = await checksOf(fresh, (dir) => writeFile(join(dir, 'index.html'), '<p>문</p>'));
    assert.deepEqual(
      door.map((c) => c.ok),
      [true, true],
    );
    const base = PageBase.from(
      Json.of({ page_id: id(7), title: '현황판', direction: '', seq: 2, files: [] }),
    );
    const growing = makeJob(92, { page: { pageId: id(7) } });
    const changed = await checksOf(growing, (dir) => writeFile(join(dir, 'data.json'), '{}'), base);
    assert.deepEqual(
      changed.map((c) => c.name),
      ['결과물 파일'],
    );
  });
});
