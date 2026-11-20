import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { AppCodeBase } from './app-code-base';
import type { CairnServer } from './cairn-server';
import { Job } from './job';
import { JobInputs } from './job-inputs';
import { JobWorkspace } from './job-workspace';
import { Json } from './json';
import type { RunEvent } from './progress';

// 앱 화면 공개를 검수하는 일 (2026-11-20): 러너가 공개될 코드를 작업 폴더의 app/에 받는다. 다른 일은 받지 않는다

const inspectJob = (action: string): Job =>
  Job.from(
    Json.of({
      task: {
        id: 'task-1',
        kind: 'general',
        title: '검수 · 첫 화면',
        payload: {
          chat: { chatId: 'chat-1', turn: 1, review: true },
          inspect: { approvalId: 'a-1', action, targetKind: 'app', targetId: 'app-1' },
        },
      },
      instruction: '검수',
      agent: { name: '검수자', role: '', tool: 'codex' },
      run_token: 'run-token',
    }),
  );

const serverWith = (asked: string[], fail = false): CairnServer =>
  ({
    async appCodeBase(taskId: string) {
      asked.push(taskId);
      if (fail) throw new Error('서버가 거절했어요');
      return AppCodeBase.from(
        Json.of({
          app_id: 'app-1',
          name: '블로그',
          kind: 'blog',
          slug: 'blog',
          seq: 2,
          files: [
            { name: 'index.html', size: 20, text: '<main>새 화면</main>' },
            { name: 'logo.png', size: 300, text: null },
          ],
          hosts: [],
        }),
      );
    },
  }) as unknown as CairnServer;

async function receive(job: Job, server: CairnServer) {
  const workspace = await JobWorkspace.open(null, null, null, '');
  const notes: string[] = [];
  try {
    await new JobInputs(job, server, 'http://127.0.0.1:1', 'read').receive(
      workspace,
      new AbortController().signal,
      (e: RunEvent) => notes.push(e.body),
    );
    const index = await readFile(
      join(workspace.workDir, AppCodeBase.DIR, 'index.html'),
      'utf8',
    ).catch(() => null);
    return { notes, index };
  } finally {
    await workspace.remove();
  }
}

describe('검수할 앱 코드 받기', () => {
  test('앱 화면 공개의 검수면 app/에 글 파일을 받는다', async () => {
    const asked: string[] = [];
    const got = await receive(inspectJob('blog.app_code.show'), serverWith(asked));
    assert.deepEqual(asked, ['task-1']);
    assert.equal(got.index, '<main>새 화면</main>');
    assert.deepEqual(got.notes, ['검수할 앱 코드 1개 파일을 받았어요']);
  });

  test('글 공개의 검수 · 대화가 아닌 일은 받지 않는다. 받지 못하면 기록만 남기고 이어 간다', async () => {
    const asked: string[] = [];
    assert.equal((await receive(inspectJob('blog.post.publish'), serverWith(asked))).index, null);
    assert.deepEqual(asked, []);
    const failed = await receive(inspectJob('blog.app_code.show'), serverWith(asked, true));
    assert.equal(failed.index, null);
    assert.deepEqual(failed.notes, ['검수할 앱 코드를 받지 못했어요: 서버가 거절했어요']);
  });
});
