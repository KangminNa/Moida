import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { ClaudeCli } from './claude-cli';
import { ClaudeStream } from './claude-stream';
import { CodexCli } from './codex-cli';
import { CodexStream } from './codex-stream';
import { Job } from './job';
import { RunMemo } from './job-lineage';
import { Json } from './json';
import { LineagePlace, LineageStore } from './lineage-store';
import { MemoHook } from './memo-hook';
import { RunEvent } from './progress';
import { RunTranscript } from './run-transcript';
import { REPO_PROMPTS } from './testing/repo-prompts';

// 에이전트 실행의 기록 (작업 세션 · 인수인계 메모 · CLI 세션 재개, 기획서 결정 2026-11-17)

let dir: string;
before(() => {
  dir = mkdtempSync(join(tmpdir(), 'cairn-lineage-'));
});
after(() => rmSync(dir, { recursive: true, force: true }));

const job = (run: object | null, more: object = {}) =>
  Job.from(
    Json.of({
      task: { id: 't-1', kind: 'general', title: '산책 글', payload: {} },
      instruction: '산책 기록을 정리해 주세요',
      agent: { name: '정리', tool: 'claude' },
      run_token: 'run-token',
      ...(run === null ? {} : { run }),
      ...more,
    }),
  );

describe('원문 (RunTranscript)', () => {
  test('AI 말 · 도구 · 오류만 남기고 결과는 빼며, 길면 가운데를 줄인다', () => {
    const transcript = new RunTranscript();
    transcript.said('기록을 읽을게요');
    transcript.did([
      new RunEvent(RunEvent.READ, 'Read notes/a.md', 10),
      new RunEvent(RunEvent.ERROR, '파일이 없어요', 0),
      new RunEvent(RunEvent.RESULT, '끝', 0),
    ]);
    const text = transcript.text('정리해 주세요');
    assert.equal(
      text,
      '[지시]\n정리해 주세요\n\n[진행]\nAI: 기록을 읽을게요\n- 도구: Read notes/a.md\n! 오류: 파일이 없어요',
    );
    const long = new RunTranscript();
    for (let i = 0; i < 2_000; i++) long.said(`${i} ${'가'.repeat(100)}`);
    const cut = long.text('지시');
    assert.ok(cut.length <= RunTranscript.MAX + 100);
    assert.match(cut, /\[… 가운데 \d+자 줄임 …\]/);
    assert.ok(cut.startsWith('[지시]') && cut.includes('1999 '), '앞과 끝이 남는다');
  });

  test('AI가 메모를 쓰지 않으면 러너가 끝난 까닭 · 마지막 답 · 부른 도구로 대신 만든다', () => {
    const transcript = new RunTranscript();
    transcript.did([new RunEvent(RunEvent.WRITE, 'delegate_task', 0)]);
    const memo = transcript.fallbackMemo('팀에게 맡겼어요', '결재나 하위 작업을 기다려요');
    assert.match(memo, /러너가 남겼어요\) 끝: 결재나 하위 작업을 기다려요/);
    assert.match(memo, /마지막 답:\n팀에게 맡겼어요/);
    assert.match(memo, /부른 도구: delegate_task/);
  });

  test('스트림이 CLI 세션 id와 원문을 모은다 (Claude의 init, Codex의 thread)', () => {
    const claude = new ClaudeStream();
    claude.read(JSON.stringify({ type: 'system', subtype: 'init', session_id: 'abc-1' }));
    claude.read(
      JSON.stringify({
        type: 'assistant',
        message: {
          id: 'm1',
          usage: {},
          content: [
            { type: 'text', text: '읽어 볼게요' },
            { type: 'tool_use', id: 'u1', name: 'Read', input: { file_path: 'a.md' } },
          ],
        },
      }),
    );
    assert.equal(claude.sessionId, 'abc-1');
    assert.match(claude.transcript.text('x'), /AI: 읽어 볼게요\n- 도구: Read a\.md/);
    const codex = new CodexStream();
    codex.read(JSON.stringify({ type: 'thread.started', thread_id: 'th-9' }));
    codex.read(
      JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: '끝' } }),
    );
    assert.equal(codex.sessionId, 'th-9');
    assert.match(codex.transcript.text('x'), /AI: 끝/);
  });
});

describe('세션 키의 자리 (LineageStore)', () => {
  test('한 실행만 잡는다. 놓으면 다시 잡을 수 있다', async () => {
    const store = new LineageStore(join(dir, 'a'));
    const first = await store.claim('task:1');
    assert.ok(first);
    assert.equal(await store.claim('task:1'), null, '같은 세션 키가 도는 중');
    assert.ok(await store.claim('task:2'), '다른 세션 키는 따로');
    await first.release();
    assert.ok(await store.claim('task:1'));
  });

  test('재개: 서버 후보와 같고, 잘 끝났고, 세션 파일이 있을 때만', async () => {
    const place = new LineagePlace(join(dir, 'b'));
    mkdirSync(join(place.root, 'config', 'projects', '-work'), { recursive: true });
    await place.remember('sess-1', true);
    assert.equal(await place.resumable('sess-1'), null, '세션 파일이 없다');
    writeFileSync(join(place.root, 'config', 'projects', '-work', 'sess-1.jsonl'), '{}');
    assert.equal(await place.resumable('sess-1'), 'sess-1');
    assert.equal(await place.resumable('sess-2'), null, '서버 후보가 다르다');
    assert.equal(await place.resumable(null), null);
    assert.equal(await place.resumable('../x'), null, '파일 이름이 될 수 없는 모양');
    const later = new Date(Date.now() + LineageStore.KEEP_MS + 1);
    assert.equal(await place.resumable('sess-1', later), null, '24시간이 지났다');
    await place.remember('sess-1', false);
    assert.equal(await place.resumable('sess-1'), null, '앞 실행이 잘 끝나지 않았다');
  });

  test('실행 앞뒤로 세션 파일 · meta · lock만 남기고, 오래된 자리는 지운다', async () => {
    const store = new LineageStore(join(dir, 'c'));
    const place = await store.claim('chat:1:a');
    assert.ok(place);
    for (const path of [
      'work/x.md',
      'home/y',
      'config/settings.json',
      'config/projects/p/s.jsonl',
    ]) {
      mkdirSync(join(place.root, path, '..'), { recursive: true });
      writeFileSync(join(place.root, path), '1');
    }
    writeFileSync(join(place.root, 'mcp.json'), '{"token":1}');
    await place.remember('s', true);
    await place.clear();
    assert.equal(existsSync(join(place.root, 'work')), false);
    assert.equal(existsSync(join(place.root, 'mcp.json')), false, '작업 토큰이 남지 않는다');
    assert.equal(existsSync(join(place.root, 'config', 'settings.json')), false);
    assert.ok(existsSync(join(place.root, 'config', 'projects', 'p', 's.jsonl')));
    assert.ok(existsSync(join(place.root, 'meta.json')));
    await place.release();

    const stale = new LineagePlace(join(dir, 'c', 'old'));
    mkdirSync(stale.root, { recursive: true });
    const old = new Date(Date.now() - LineageStore.KEEP_MS - 60_000);
    utimesSync(stale.root, old, old);
    await store.sweep();
    assert.equal(existsSync(stale.root), false, '24시간 지난 자리');
    assert.ok(existsSync(place.root), '최근 자리는 남는다');
  });

  test('세션 키 폴더가 링크면 쓰지 않고, 내 폴더가 넓게 열려 있으면 700으로 좁힌다 (공유 임시 폴더)', async () => {
    const real = join(dir, 'real');
    mkdirSync(real, { mode: 0o700 });
    symlinkSync(real, join(dir, 'link'));
    await assert.rejects(new LineageStore(join(dir, 'link')).claim('chat:링크'), /링크/);
    assert.deepEqual(readdirSync(real), [], '링크 너머에 쓰지 않는다');

    const open = join(dir, 'open');
    mkdirSync(open);
    chmodSync(open, 0o777);
    const place = await new LineageStore(open).claim('chat:열림');
    assert.ok(place);
    assert.equal(statSync(open).mode & 0o777, 0o700);
    await place.release();
  });
});

describe('인수인계 메모와 재개 (지시문 · Claude 인자)', () => {
  test('세션 키가 있는 일: 지난 메모(자료)와 메모 쓰는 법을 싣는다', () => {
    const plain = job({ lineage: 'task:t-1', keep: true, resume: null });
    assert.equal(plain.lineage?.key, 'task:t-1');
    const memo = new RunMemo('2026-11-17T01:00:00Z', '정리', '산책 글', 1, '사진 셋을 골랐다');
    const started = plain.withLineage(plain.lineage?.started(null, [memo]) ?? null);
    const text = started.prompt(REPO_PROMPTS, false, null, null, '/w/.cairn/memo.md');
    assert.match(text, /# 지난 인수인계 메모 \(자료\)/);
    assert.match(text, /## 2026-11-17T01:00:00Z · 정리 · 산책 글 \(1번째 실행\)\n사진 셋을 골랐다/);
    assert.match(text, /# 인수인계 메모\n이 실행을 끝내기 전에 .* \/w\/\.cairn\/memo\.md 파일에/);
    assert.equal(text.includes('# 이어서 하는 실행'), false);
    assert.equal(job(null).lineage, null, '기록하지 않는 일');
    assert.equal(job(null).prompt(REPO_PROMPTS, false).includes('인수인계'), false);
  });

  test('재개한 실행: 머리글을 앞에, 이전 대화 · 지난 메모는 뺀다', () => {
    const chat = {
      task: {
        id: 't-2',
        kind: 'general',
        title: '대화',
        payload: { chat: { chatId: 'c', turn: 2, history: [{ from: 'owner', text: '앞 질문' }] } },
      },
    };
    const turn = job({ lineage: 'chat:c:a', keep: true, resume: { cli_session: 's1' } }, chat);
    assert.equal(turn.lineage?.candidate, 's1');
    const memo = new RunMemo('t', '정리', '대화', 1, '앞 메모');
    const resumed = turn.withLineage(turn.lineage?.started('s1', [memo]) ?? null);
    const text = resumed.prompt(REPO_PROMPTS, false, null, null, '/m.md');
    assert.ok(text.startsWith('# 이어서 하는 실행'));
    assert.equal(text.includes('앞 질문'), false, '이전 대화는 CLI 세션에 있다');
    assert.equal(text.includes('앞 메모'), false);
    assert.match(text, /# 인수인계 메모/);
    const fresh = turn.withLineage(turn.lineage?.started(null, []) ?? null);
    assert.match(fresh.prompt(REPO_PROMPTS, false, null, null, '/m.md'), /앞 질문/);
  });

  test('Claude: 고정 자리면 세션을 남기고 재개하며, 메모가 비면 Stop 훅이 한 번 막는다', async () => {
    const place = new LineagePlace(join(dir, 'claude'));
    mkdirSync(place.root, { recursive: true });
    const base = job({ lineage: 'task:t-1', keep: true, resume: { cli_session: 's1' } });
    const ready = base.withLineage(base.lineage?.started('s1', []) ?? null);
    const cli = new ClaudeCli('claude', 'oauth-token', 'https://blog/mcp');
    const workspace = await cli.open(ready, null, place);
    const args = [...cli.args(workspace)];
    assert.equal(args.includes('--no-session-persistence'), false);
    assert.equal(args[args.indexOf('--resume') + 1], 's1');
    assert.equal(workspace.workDir, join(place.root, 'work'), '세션 키마다 같은 작업 폴더');
    assert.equal(workspace.memoPath, join(place.root, 'work', '.cairn', 'memo.md'));
    assert.equal(readFileSync(workspace.memoPath ?? '', 'utf8'), '');
    const settings = JSON.parse(readFileSync(join(workspace.configDir, 'settings.json'), 'utf8'));
    assert.ok(settings.hooks.Stop[0].hooks[0].command.includes('memo-stop.cjs'));
    const env = cli.env(workspace, {}, '메모를 써 주세요');
    assert.equal(env[MemoHook.FILE_ENV], workspace.memoPath);

    const hook = (input: object) =>
      spawnSync(process.execPath, [join(workspace.configDir, 'hooks', 'memo-stop.cjs')], {
        input: JSON.stringify(input),
        env: { ...env },
        encoding: 'utf8',
      }).stdout;
    assert.deepEqual(JSON.parse(hook({ stop_hook_active: false })), {
      decision: 'block',
      reason: '메모를 써 주세요',
    });
    assert.equal(hook({ stop_hook_active: true }), '', '한 번 막은 뒤에는 끝낸다');
    writeFileSync(workspace.memoPath ?? '', '한 일: 정리');
    assert.equal(hook({ stop_hook_active: false }), '', '메모가 있으면 끝낸다');
    assert.equal(await workspace.readMemo(4_000), '한 일: 정리');
    await workspace.remove();
    assert.ok(existsSync(place.root), '고정 자리는 남는다');
    assert.equal(existsSync(join(place.root, 'work')), false);

    const plain = new ClaudeCli('claude', 'oauth-token');
    const plainSpace = await plain.open(job(null));
    assert.ok(
      plain.args(plainSpace).includes('--no-session-persistence'),
      '그 밖의 일은 남기지 않는다',
    );
    assert.equal(plainSpace.memoPath, null, '기록하지 않는 일은 메모 파일이 없다');
    await plainSpace.remove();
  });

  test('Codex: 메모 파일은 두되 늘 새로 시작한다 (--ephemeral)', async () => {
    const codex = new CodexCli('codex', '{"tokens":{}}', 'https://blog/mcp', dir);
    const workspace = await codex.open(job({ lineage: 'task:t-1', keep: true, resume: null }));
    assert.ok(codex.args(workspace).includes('--ephemeral'));
    assert.equal(workspace.memoPath, join(workspace.workDir, '.cairn', 'memo.md'));
    await workspace.remove();
  });
});
