import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { BrowseJob, BrowseSite } from './browse-job';
import { BrowserSlot } from './browser-slot';
import type { ExecOutcome, IntegrationExec } from './integration-exec';
import { IntegrationRunner } from './integration-runner';
import { Json } from './json';
import type { RunEvent } from './progress';
import { Redactor, RunLog } from './redactor';
import { SiteBuild, SiteBuildPlan } from './site-build';
import type { BuildTest, BuildVerdict, QueuedRun, SiteToolCalls } from './site-tool-calls';

// 사이트 도구 굳히기 · 실행의 러너 쪽 (2026-11-16 MCP 2단계). 서버 · 브라우저 없이 가짜로 본다
// (실제 Chromium으로 코드를 돌리는 것은 integration-exec.test.ts)

const SECRET = 'very-secret-token-123';
const redactor = new Redactor([SECRET]);
const site = new BrowseSite('s1', 2, '시세', 'https://quotes.example/', ['https://quotes.example']);
const never = new AbortController().signal;
const noop = (_event: RunEvent) => {};

/** 입력마다 정해 둔 결과를 내는 가짜 실행기 */
function fakeExec(outcome: (input: Record<string, unknown>) => ExecOutcome): IntegrationExec {
  return { run: async (_c: string, input: Record<string, unknown>) => outcome(input) } as never;
}

/** 받은 시험을 남기고 정해 둔 판정을 주는 가짜 서버 */
function fakeCalls(verdict: Partial<BuildVerdict>) {
  const saved: BuildTest[][] = [];
  const calls = {
    saveBuild: async (_task: string, _tool: unknown, tests: readonly BuildTest[]) => {
      saved.push([...tests]);
      return {
        accepted: false,
        seq: 1,
        integrationVersion: 3,
        passed: 0,
        total: tests.length,
        rounds: 1,
        problems: [],
        ...verdict,
      } as BuildVerdict;
    },
  } as unknown as SiteToolCalls;
  return { calls, saved };
}

const plan = SiteBuildPlan.from(
  Json.of({
    build: {
      integration_id: 'i1',
      name: 'quote',
      title: '시세',
      description: '종가',
      last: null,
      recent_errors: [],
    },
  }),
) as SiteBuildPlan;

let work: string;

async function writeTool(files: Record<string, string>): Promise<void> {
  await rm(join(work, SiteBuild.DIR), { recursive: true, force: true });
  await mkdir(join(work, SiteBuild.DIR));
  for (const [name, text] of Object.entries(files))
    await writeFile(join(work, SiteBuild.DIR, name), text);
}

const GOOD = {
  'tool.json': JSON.stringify({
    input_schema: { type: 'object', properties: { s: { type: 'string' } } },
    output_schema: { type: 'object', properties: { p: { type: 'number' } } },
  }),
  'code.js': 'await page.goto(site.start_url);\nreturn { p: 1 };',
  'tests.json': JSON.stringify([
    { name: 'a', input: { s: 'a' } },
    { input: { s: 'b' } },
    { name: 'c', input: { s: 'c' } },
  ]),
};

before(async () => {
  work = await mkdtemp(join(tmpdir(), 'cairn-site-build-'));
});
after(async () => {
  await rm(work, { recursive: true, force: true });
});

describe('SiteBuildPlan', () => {
  test('사이트 일에만 build가 있고, 앞 버전의 틀린 시험이 지시문 글에 실린다', () => {
    const body = Json.of({
      site: {
        id: 's1',
        version: 2,
        name: '시세',
        start_url: 'https://quotes.example/',
        origins: ['https://quotes.example'],
      },
      build: {
        integration_id: 'i1',
        name: 'quote',
        title: '시세',
        description: '종가',
        last: {
          seq: 2,
          input_schema: { type: 'object' },
          output_schema: { type: 'object' },
          code: 'return {};',
          tests: [
            { name: 'a', ok: true, problem: null },
            { name: 'b', ok: false, problem: '$.p: number이어야 해요' },
          ],
        },
        recent_errors: ['표를 찾지 못했어요'],
      },
    });
    const job = BrowseJob.from(body);
    assert.equal(job.build?.name, 'quote');
    assert.match(String(job.build?.last), /버전 2[\s\S]*- b: \$\.p: number/);
    assert.deepEqual(job.build?.errors, ['표를 찾지 못했어요']);
    assert.equal(
      BrowseJob.from(Json.of({ build: body.field('build') })).build,
      null,
      '둘러보기에는 없다',
    );
  });
});

describe('SiteBuild.read', () => {
  test('세 파일이 있어야 하고, 입력이 있는 시험이 3개부터. 이름 없는 시험은 번호로', async () => {
    await writeTool({ 'code.js': 'return {};' });
    assert.match(String(await SiteBuild.read(join(work, SiteBuild.DIR))), /모두 있어야/);
    await writeTool({ ...GOOD, 'tool.json': '{' });
    assert.match(String(await SiteBuild.read(join(work, SiteBuild.DIR))), /JSON이 아니에요/);
    await writeTool({ ...GOOD, 'tests.json': JSON.stringify([{ input: {} }, { input: 1 }]) });
    assert.match(String(await SiteBuild.read(join(work, SiteBuild.DIR))), /3개 이상/);
    await writeTool(GOOD);
    const read = await SiteBuild.read(join(work, SiteBuild.DIR));
    assert.ok(typeof read !== 'string');
    assert.deepEqual(
      read.tests.map((t) => t.name),
      ['a', '시험 2', 'c'],
    );
  });
});

describe('SiteBuild.finish', () => {
  test('통과하면 켜기 결재(서버가 준 도구의 판)와 함께 끝낸다. 시험의 오류 글에서 비밀값을 지운다', async () => {
    await writeTool(GOOD);
    const exec = fakeExec((input) =>
      input.s === 'c'
        ? { ok: false, error: `실패 ${SECRET}`, kind: 'code', ms: 3 }
        : { ok: true, output: { p: 1 }, ms: 3 },
    );
    const { calls, saved } = fakeCalls({
      accepted: true,
      passed: 2,
      seq: 4,
      integrationVersion: 7,
    });
    const built = await new SiteBuild(calls, exec, 't1').finish(
      plan,
      site,
      work,
      never,
      noop,
      redactor,
    );
    assert.equal(built.ending.succeeded, true);
    assert.deepEqual(
      [built.approval?.action, built.approval?.targetId, built.approval?.targetVersion],
      ['browser.integration.enable', 'i1', 7],
    );
    const failed = saved[0]?.find((t) => !t.outcome.ok);
    assert.ok(failed && !failed.outcome.ok && !failed.outcome.error.includes(SECRET));
  });

  test('70% 미만이면 첫 회차는 일을 돌려주고(다음 회차가 고친다), 두 번째는 실패로 끝낸다', async () => {
    await writeTool(GOOD);
    const exec = fakeExec(() => ({ ok: true, output: { p: 'x' }, ms: 1 }));
    const first = await new SiteBuild(
      fakeCalls({ rounds: 1, problems: ['a: $.p'] }).calls,
      exec,
      't1',
    ).finish(plan, site, work, never, noop, redactor);
    assert.match(String(first.ending.releaseReason), /70% 미만.*한 번 더/);
    assert.equal(first.approval, null);
    const second = await new SiteBuild(fakeCalls({ rounds: 2 }).calls, exec, 't1').finish(
      plan,
      site,
      work,
      never,
      noop,
      redactor,
    );
    assert.equal(second.ending.releaseReason, null);
    assert.equal(second.ending.result?.status, 'failed');
  });

  test('쓰기 도구는 시험을 마른 실행으로 돌리고, 받아들여지면 켜기 결재 없이 검토자에게 넘긴다', async () => {
    await writeTool({
      ...GOOD,
      'code.js':
        "await page.goto(site.start_url);\nawait site.commit(page.getByRole('button', { name: '게시' }));\nreturn {};",
    });
    const writePlan = SiteBuildPlan.from(
      Json.of({
        build: {
          integration_id: 'i2',
          mode: 'write',
          name: 'post',
          title: '글',
          description: '올림',
        },
      }),
    ) as SiteBuildPlan;
    const modes: unknown[] = [];
    const exec = {
      run: async (..._args: unknown[]) => {
        modes.push(_args[5]);
        return { ok: true, output: {}, ms: 1, dry: true };
      },
    } as never;
    const built = await new SiteBuild(
      fakeCalls({ accepted: true, review: true, passed: 3 }).calls,
      exec,
      't2',
    ).finish(writePlan, site, work, never, noop, redactor);
    assert.equal(built.ending.succeeded, true);
    assert.equal(built.approval, null, '켜기 결재는 검토자가 올린다');
    assert.deepEqual(modes[0], { mode: 'write', dryRun: true });
  });

  test('파일이 없으면 시험을 돌리지 않고 실패', async () => {
    await rm(join(work, SiteBuild.DIR), { recursive: true, force: true });
    const { calls, saved } = fakeCalls({});
    const built = await new SiteBuild(
      calls,
      fakeExec(() => ({ ok: true, output: {}, ms: 0 })),
      't1',
    ).finish(plan, site, work, never, noop, redactor);
    assert.equal(built.ending.result?.status, 'failed');
    assert.equal(saved.length, 0);
  });
});

describe('IntegrationRunner', () => {
  test('꺼낸 실행을 돌려 남기고(오류 글의 비밀값은 지움), 브라우저 자리를 놓는다', async () => {
    const stop = new AbortController();
    const run: QueuedRun = {
      id: 'r1',
      mode: 'read',
      code: 'return {};',
      input: {},
      timeoutMs: 1000,
      site: { name: '시세', startUrl: site.startUrl, origins: site.origins },
    };
    let given: QueuedRun | null = run;
    const saved: [string, ExecOutcome][] = [];
    const calls = {
      nextRun: async () => {
        const next = given;
        given = null;
        return next;
      },
      saveRun: async (id: string, outcome: ExecOutcome) => {
        saved.push([id, outcome]);
        stop.abort();
      },
    } as unknown as SiteToolCalls;
    const slot = new BrowserSlot();
    const exec = fakeExec(() => ({ ok: false, error: `로그인 ${SECRET}`, kind: 'login', ms: 5 }));
    await new IntegrationRunner(calls, exec, slot, new RunLog(redactor), redactor).run(stop.signal);
    const [id, outcome] = saved[0] ?? [];
    assert.equal(id, 'r1');
    assert.ok(
      outcome && !outcome.ok && outcome.kind === 'login' && !outcome.error.includes(SECRET),
    );
    const free = await slot.take(new AbortController().signal);
    assert.ok(free, '자리를 놓았다');
    free?.();
  });
});
