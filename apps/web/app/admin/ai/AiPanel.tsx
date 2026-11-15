'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '../../_lib/client-api';
import { useAction } from '../../_lib/use-action';
import { useLiveValue } from '../../_lib/use-live';
import { when } from '../../_task/labels';
import { TASK_TOPICS, useAiTools, useEngines } from '../../_task/live';
import type { AiTest, AiTool, Task } from '../../_task/types';
import { SigninBox } from './AiSignin';

const DAY_MS = 86_400_000;
/** 만료가 이만큼 남으면 알린다 */
const WARN_DAYS = 30;
/** 로그인 단계는 작업의 상태가 아니라서 신호가 없다. 로그인하는 동안만 이 간격으로 다시 읽는다 */
const SIGNIN_REREAD_MS = 2_000;

function stateOf(tool: AiTool): string {
  if (tool.connected) return '연결됨';
  return tool.expiresAt ? '만료됨' : '로그인 전';
}

/** 만료까지 남은 날. 지났으면 null */
function daysLeft(expiresAt: string): number | null {
  const left = new Date(expiresAt).getTime() - Date.now();
  return left > 0 ? Math.ceil(left / DAY_MS) : null;
}

function checkOf(tool: AiTool): string {
  if (!tool.checkedAt) return '확인 전';
  return `${tool.lastError ? '실패' : '정상'} · ${when(tool.checkedAt)}`;
}

// AI 로그인. 러너가 로그인 명령을 대신 돌리고(웹 로그인), 주인은 주소에서 로그인해 코드를 붙여 넣는다.
// Claude는 토큰을 직접 넣을 수도 있다. 토큰은 서버가 돌려주지 않아 화면에 다시 보이지 않는다.
export function AiPanel() {
  const tools = useAiTools();
  const { reload } = tools;
  const signingIn = tools.data?.tools.some((t) => t.signin !== null) ?? false;
  useEffect(() => {
    if (!signingIn) return;
    const timer = setInterval(() => void reload(), SIGNIN_REREAD_MS);
    return () => clearInterval(timer);
  }, [signingIn, reload]);

  return (
    <>
      <header className="page-head">
        <h1>AI 계정</h1>
      </header>
      {tools.error && <p className="error">{tools.error}</p>}
      {tools.data
        ? tools.data.tools.map((tool) => <ToolCard key={tool.tool} tool={tool} reload={reload} />)
        : !tools.error && <p className="label-mono">불러오는 중…</p>}
      <p className="note">
        로그인은 러너가 돌려요. 러너가 꺼져 있으면 시작되지 않아요 ·{' '}
        <Link href="/admin/runners">러너 메뉴</Link>
      </p>
    </>
  );
}

// 엔진마다 다른 것(이름 · 토큰을 직접 넣는지 · 로그인 흐름)은 엔진 목록(GET /api/ai/engines, 리팩토링 E1)을 따른다
function ToolCard({ tool, reload }: { tool: AiTool; reload: () => Promise<void> }) {
  const engine = useEngines().find((e) => e.name === tool.tool);
  const name = engine?.label ?? tool.tool;
  // 토큰 한 줄로 로그인하는 엔진(login.token)은 만료가 있고 토큰을 직접 넣을 수 있다
  return (
    <section className="panel" aria-label={name}>
      <h2>{name}</h2>
      {engine?.login.token ? (
        <TokenState tool={tool} />
      ) : (
        <dl className="kv">
          <dt>상태</dt>
          <dd>{stateOf(tool)}</dd>
        </dl>
      )}
      <SigninBox tool={tool} engine={engine} reload={reload} />
      {engine?.login.token ? (
        <details className="more">
          <summary>토큰 직접 넣기</summary>
          <TokenForm tool={tool} reload={reload} />
        </details>
      ) : (
        <p className="note">에이전트의 AI 도구를 {name}로 고르면 이 로그인으로 일해요</p>
      )}
    </section>
  );
}

/** 토큰으로 로그인하는 엔진: 만료와 연결 확인 */
function TokenState({ tool }: { tool: AiTool }) {
  const action = useAction();
  // 맡긴 연결 확인의 작업. 끝나면 결과는 /api/ai로 온다
  const [testing, setTesting] = useState<string | null>(null);
  const test = useLiveValue(
    `ai-test:${testing}`,
    () =>
      testing
        ? api<Task | null>('GET', `/api/tasks/${testing}`)
        : Promise.resolve({ ok: true as const, data: null }),
    TASK_TOPICS,
  );
  const pending =
    testing !== null && (test.data === null || ['queued', 'running'].includes(test.data.status));
  const left = tool.expiresAt ? daysLeft(tool.expiresAt) : null;

  async function startTest() {
    const reply = await action.run('test', () => api<AiTest>('POST', `/api/ai/${tool.tool}/test`));
    if (reply?.ok) setTesting(reply.data.taskId);
  }

  return (
    <>
      {action.problem && <p className="error">{action.problem}</p>}
      <dl className="kv">
        <dt>상태</dt>
        <dd>{stateOf(tool)}</dd>
        {tool.expiresAt && (
          <>
            <dt>만료</dt>
            <dd>{new Date(tool.expiresAt).toLocaleDateString('ko-KR')}</dd>
          </>
        )}
        <dt>연결 확인</dt>
        <dd>{pending ? '확인 중' : checkOf(tool)}</dd>
        {tool.lastError && !pending && (
          <>
            <dt>이유</dt>
            <dd>{tool.lastError}</dd>
          </>
        )}
      </dl>
      {left !== null && left <= WARN_DAYS && (
        <p>
          <span className="pill strong">만료 {left}일 전 · 다시 로그인 필요</span>
        </p>
      )}
      {tool.connected && (
        <button
          type="button"
          className="ghost fit"
          disabled={action.busy !== null || pending}
          onClick={startTest}
        >
          연결 확인
        </button>
      )}
      {pending && <p className="note">러너가 일을 맡으면 끝나요</p>}
    </>
  );
}

/** 직접 만든 토큰 (토큰으로 로그인하는 엔진, 예: claude setup-token) */
function TokenForm({ tool, reload }: { tool: AiTool; reload: () => Promise<void> }) {
  const action = useAction();
  const [token, setToken] = useState('');

  function save(event: React.FormEvent) {
    event.preventDefault();
    void action.run(
      'token',
      async () => {
        const reply = await api('PUT', `/api/ai/${tool.tool}/token`, { token: token.trim() });
        // 틀린 값도 칸에 남기지 않는다. 가려져 있어 고칠 수 없고 다시 붙여 넣으면 된다
        setToken('');
        return reply;
      },
      { done: '토큰 저장됨', reload },
    );
  }

  return (
    <form className="stack" onSubmit={save}>
      {action.problem && <p className="error">{action.problem}</p>}
      <label className="field">
        <span>{tool.expiresAt ? '새 토큰' : '토큰'}</span>
        <input
          className="input"
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={token}
          onChange={(e) => setToken(e.target.value)}
          required
        />
        <small>claude setup-token의 값. 끊긴 곳 없이 한 줄로</small>
      </label>
      <button
        className="cta small fit"
        type="submit"
        disabled={action.busy !== null || !token.trim()}
      >
        저장
      </button>
    </form>
  );
}
