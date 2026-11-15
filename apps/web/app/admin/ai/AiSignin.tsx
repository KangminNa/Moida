'use client';

import { useEffect, useState } from 'react';
import { api } from '../../_lib/client-api';
import { useAction } from '../../_lib/use-action';
import { useLiveValue } from '../../_lib/use-live';
import { TASK_TOPICS } from '../../_task/live';
import type { AiTest, AiTool, Engine, TaskDetail } from '../../_task/types';
import { useNotify } from '../../_ui/notify';

// AI 메뉴의 웹 로그인 (AiPanel에서 나눔): 러너가 로그인 명령을 대신 돌리고, 관리자는 주소에서 로그인한다.
// 흐름은 엔진 목록의 login.flow: paste_code는 브라우저에 나온 코드를 붙여 넣고, device_code는 주소에서 코드를 입력한다

type Signin = NonNullable<AiTool['signin']>;

/** 서버가 정해진 출처만 받지만, 링크로 여는 것은 https일 때만 */
function safeUrl(url: string | null): string | null {
  return url?.startsWith('https://') ? url : null;
}

/**
 * 웹 로그인. 진행 중인 로그인은 /api/ai의 signin으로 온다 (새로 고쳐도 이어진다).
 * 이 화면에서 시작한 로그인이 끝나면 작업을 읽어 실패 이유를 보인다
 */
export function SigninBox({
  tool,
  engine,
  reload,
}: {
  tool: AiTool;
  engine: Engine | undefined;
  reload: () => Promise<void>;
}) {
  const notify = useNotify();
  const name = engine?.label ?? tool.tool;
  const action = useAction();
  const busy = action.busy !== null;
  const [started, setStarted] = useState<string | null>(null);
  const signin = tool.signin;
  const ended = useLiveValue(
    `ai-signin:${started}`,
    () =>
      started && signin === null
        ? api<TaskDetail>('GET', `/api/tasks/${started}`)
        : Promise.resolve({ ok: true as const, data: null }),
    TASK_TOPICS,
  );
  const result = ended.data;
  const failure =
    result?.status === 'failed'
      ? String((result.result as { error?: unknown } | null)?.error ?? '로그인하지 못했어요')
      : null;

  useEffect(() => {
    if (result?.status !== 'done') return;
    notify(`${name} 로그인됨`);
    setStarted(null);
  }, [result?.status, name, notify]);

  async function start() {
    const reply = await action.run('start', () =>
      api<AiTest>('POST', `/api/ai/${tool.tool}/signin`),
    );
    if (!reply?.ok) return;
    setStarted(reply.data.taskId);
    await reload();
  }

  // 취소에는 작업의 지금 version이 든다: 누를 때 읽어서 보낸다
  async function cancel(taskId: string) {
    await action.run('cancel', async () => {
      const task = await api<TaskDetail>('GET', `/api/tasks/${taskId}`);
      return task.ok
        ? api('POST', `/api/tasks/${taskId}/cancel`, { version: task.data.version })
        : task;
    });
    setStarted(null);
    await reload();
  }

  if (signin === null)
    return (
      <div className="stack">
        {action.problem && <p className="error">{action.problem}</p>}
        {failure && <p className="error">{failure}</p>}
        <button
          type="button"
          className={tool.connected ? 'ghost fit' : 'cta small fit'}
          disabled={busy}
          onClick={start}
        >
          {tool.connected ? '다시 로그인' : '브라우저로 로그인'}
        </button>
      </div>
    );

  return (
    <section className="stack" aria-label={`${name} 로그인`}>
      {action.problem && <p className="error">{action.problem}</p>}
      <SigninSteps signin={signin} tool={tool.tool} flow={engine?.login.flow ?? ''} />
      <button
        type="button"
        className="ghost fit"
        disabled={busy}
        onClick={() => cancel(signin.taskId)}
      >
        로그인 취소
      </button>
    </section>
  );
}

/** flow: 엔진의 로그인 흐름 (device_code: 주소에서 코드 입력, paste_code: 브라우저의 코드를 붙여 넣음) */
function SigninSteps({ signin, tool, flow }: { signin: Signin; tool: string; flow: string }) {
  const url = safeUrl(signin.url);
  if (signin.step === 'starting' || url === null)
    return <p className="label-mono">러너가 로그인을 여는 중…</p>;
  if (signin.step === 'verifying') return <p className="label-mono">코드를 확인하는 중…</p>;
  const open = (
    <a className="cta small fit" href={url} target="_blank" rel="noopener noreferrer">
      로그인 페이지 열기
    </a>
  );
  if (flow === 'device_code')
    return (
      <ol className="signin-steps">
        <li>
          <span>로그인 페이지에서 로그인</span>
          {open}
        </li>
        <li>
          <span>이 코드 넣기</span>
          <code className="signin-code">{signin.userCode}</code>
          <small className="note">넣으면 저절로 연결돼요. 남이 보낸 코드는 넣지 마세요</small>
        </li>
      </ol>
    );
  return (
    <ol className="signin-steps">
      <li>
        <span>로그인 페이지에서 로그인</span>
        {open}
      </li>
      <li>
        <span>브라우저에 나온 코드 붙여 넣기</span>
        <CodeForm tool={tool} taskId={signin.taskId} />
      </li>
    </ol>
  );
}

/** 브라우저에 나온 코드 (코드를 붙여 넣는 엔진). 러너가 받아 로그인 명령에 쳐 넣는다 */
function CodeForm({ tool, taskId }: { tool: string; taskId: string }) {
  const action = useAction();
  const [code, setCode] = useState('');

  async function send(event: React.FormEvent) {
    event.preventDefault();
    const reply = await action.run('code', () =>
      api('POST', `/api/ai/${tool}/signin/code`, { taskId, code: code.trim() }),
    );
    if (reply?.ok) setCode('');
  }

  return (
    <form className="row" onSubmit={send}>
      <input
        className="input"
        aria-label="로그인 코드"
        autoComplete="off"
        spellCheck={false}
        value={code}
        onChange={(e) => setCode(e.target.value)}
        required
      />
      <button className="cta small" type="submit" disabled={action.busy !== null || !code.trim()}>
        저장
      </button>
      {action.problem && <p className="error">{action.problem}</p>}
    </form>
  );
}
