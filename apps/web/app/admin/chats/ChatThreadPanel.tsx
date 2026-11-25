'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useMe } from '../../_account/live';
import { useApps } from '../../_blog/live';
import { api, uploadFile } from '../../_lib/client-api';
import { useAction } from '../../_lib/use-action';
import { useLive, useLiveValue } from '../../_lib/use-live';
import { ChatCardForm } from '../../_task/ChatCardForm';
import { scheduleLabel, tokens } from '../../_task/labels';
import { CHAT_DETAIL_TOPICS, CHAT_LOG_TOPICS, useLead } from '../../_task/live';
import type { Chat, ChatDetail, ChatNews, OutputSaved } from '../../_task/types';
import { STORE_HREF } from '../menu';
import { ChatBriefForm } from './ChatBriefForm';
import { changeMessage, type Decision } from './ChatDecisions';
import { ChatForm, type ChatMessageBody } from './ChatForm';
import type { RefChoice } from './ChatRefs';
import { ChatRuntimeForm } from './ChatRuntimeForm';
import { ChatTeamPanel } from './ChatTeamPanel';
import { ChatTurns } from './ChatTurns';
import { PHOTO_TYPES } from './chat-photos';

/** 도는 상태 (멈추기가 보인다) */
const RUNNING = ['working'];
/** 끝나지 않은 회차 작업의 상태 (이때 보내면 덧붙인 말) */
const TURN_OPEN = ['queued', 'running', 'waiting'];

// 대화 하나 (2차 1-5, ChatGPT · Claude 같은 모양): 가운데 주고받음, 아래 입력 칸 하나.
// 일꾼이 일하는 동안에는 오른쪽에 "일꾼이 동시에 일하는 중" 칸이 붙는다 (ChatTeamPanel, 좁은 화면에서는 숨긴다).
// 상대는 늘 대표 (O-2): 대표가 일꾼에게 나눠 맡기고, 승인은 결과 카드 하나로 정한다 (2차 2단계).
// 일하는 중에도 보낸다: 덧붙인 말이 되고 대표가 짧게 답한다 (2차 1-1). 신호가 오면 다시 읽는다
export function ChatThreadPanel({ id }: { id: string }) {
  // 대상(id)으로 거르지 않는다: 신호의 대상은 회차 작업 · 승인이라 대화 id가 아니다
  const detail = useLiveValue(
    `chat:${id}`,
    () => api<ChatDetail>('GET', `/api/chats/${id}`),
    CHAT_DETAIL_TOPICS,
  );
  // 진행 기록은 이 대화에서 도는 작업(회차 · 덧붙인 말의 답 · 그 아래)의 것만 다시 읽는다. 새 하위 작업은
  // 작업 신호(task.task.changed)로 다시 읽어 목록에 들어온다
  useLive(CHAT_LOG_TOPICS, detail.reload, detail.data?.team.map((t) => t.taskId) ?? []);
  const me = useMe();
  const apps = useApps();
  const sending = useAction();
  const cancelling = useAction();
  const deciding = useAction();
  const stopping = useAction();
  const trashing = useAction();
  const router = useRouter();
  const tuning = useAction();
  const uploading = useAction();
  const hurrying = useAction();
  const waking = useAction();
  const lead = useLead();
  /** 응답을 못 받아 다시 보내도 메시지가 한 번만 가게 (보낸 뒤에만 바꾼다) */
  const requestId = useRef('');
  if (!requestId.current) requestId.current = crypto.randomUUID();
  /** 보낸 횟수: 보내면 폼을 새로 만들어 칸을 비운다 (소식이 와도 쓰던 글은 그대로) */
  const [sent, setSent] = useState(0);
  const bottom = useRef<HTMLDivElement>(null);
  const d = detail.data;

  // 새 회차 · 답 · 카드가 오면 맨 아래로
  // biome-ignore lint/correctness/useExhaustiveDependencies: 주고받음의 길이와 상태가 바뀔 때만
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [d?.turns.length, d?.turns.at(-1)?.status, d?.news.length, d?.state, d?.card?.id]);

  if (!d)
    return detail.status === 404 ? (
      <p className="rows-empty">찾을 수 없는 대화</p>
    ) : detail.error ? (
      <p className="error">{detail.error}</p>
    ) : (
      <p className="label-mono">불러오는 중…</p>
    );

  // 상대가 없으면(O-2 전에 맡기 전이던 대화) 보내는 말에 대표가 맡는다
  const { partner } = d;
  const blocked = partner?.paused ? '대표를 멈췄어요. 설정 › AI에서 다시 시작해요' : null;
  const hint =
    d.state === 'working' ? '일하는 중. 보내면 덧붙인 말이 되고 짧게 답해요 (회차마다 5개)' : null;

  async function send(body: ChatMessageBody): Promise<boolean> {
    const reply = await sending.run(
      'send',
      () =>
        api<Chat>('POST', `/api/chats/${id}/messages`, {
          requestId: requestId.current,
          version: d?.chat.version,
          ...body,
        }),
      { reload: detail.reload, conflict: '그사이 바뀐 대화예요. 최신 내용을 다시 읽었어요' },
    );
    if (!reply?.ok) return false;
    requestId.current = crypto.randomUUID();
    setSent((n) => n + 1);
    return true;
  }
  /** 판단 바꾸기 (L1): 덧붙인 말로 보내고, 회차가 일꾼을 기다리는 중이면 먼저 깨워 대표가 그 단계부터 다시 맡기게 한다 */
  async function changeDecision(news: ChatNews, decision: Decision, change: string) {
    const turn = d?.turns.at(-1);
    if (!(await send({ message: changeMessage(news, decision, change) }))) return;
    if (turn?.status !== 'waiting' || turn.waitReason !== 'subtasks') return;
    await waking.run('wake', () => api('POST', `/api/tasks/${turn.taskId}/wake`), {
      done: '대표가 바뀐 판단으로 다시 맡겨요',
      reload: detail.reload,
    });
  }

  const decide = (body: { decision: string; note?: string; picked?: string[] }) =>
    d.card &&
    deciding.run(
      'decide',
      () =>
        api('POST', `/api/approvals/${d.card?.id}/decide`, { version: d.card?.version, ...body }),
      {
        done: body.decision === 'approve' ? '고른 것만 남겼어요' : '정했어요',
        reload: detail.reload,
        conflict: '그사이 카드에 항목이 더해졌어요. 다시 골라요',
      },
    );

  // 결과 카드가 기다리는 중이면 멈추기가 그 카드까지 취소한다: 고르기 전의 결과를 한 번에 잃지 않게 묻는다
  const stop = () =>
    (!d.card || window.confirm('멈출까요? 기다리는 결과 카드도 함께 취소돼요')) &&
    stopping.run('stop', () => api('POST', `/api/chats/${id}/stop`, { version: d.chat.version }), {
      done: '멈췄어요',
      reload: detail.reload,
      conflict: '그사이 바뀐 대화예요. 최신 내용을 다시 읽었어요',
    });

  /** 휴지통으로 (2026-11-19 휴지통 A): 도는 일은 멈추고 목록에서 빠진다. 대화 휴지통에서 복원한다 */
  const trash = async () => {
    if (!window.confirm('휴지통으로 보낼까요? 도는 일은 멈춰요. 휴지통에서 복원할 수 있어요'))
      return;
    const send = () => api('POST', `/api/chats/${id}/trash`, { version: d.chat.version });
    const reply = await trashing.run('trash', send, {
      done: '휴지통으로 보냈어요',
      conflict: '그사이 바뀐 대화예요. 최신 내용을 다시 읽었어요',
      reload: detail.reload,
    });
    if (reply?.ok) router.replace('/admin');
  };

  /** 일꾼을 기다리는 작업을 지금까지의 결과로 마무리하게 깨운다 (일꾼 기다리기) */
  const hurry = (taskId: string) =>
    hurrying.run(`hurry:${taskId}`, () => api('POST', `/api/tasks/${taskId}/hurry`), {
      done: '지금까지의 결과로 답하게 했어요',
      reload: detail.reload,
    });

  const tune = (body: { model: string | null; effort: string | null }) =>
    tuning.run(
      'tune',
      () => api('PATCH', `/api/chats/${id}`, { version: d.chat.version, ...body }),
      {
        done: '이 대화의 모델을 바꿨어요',
        reload: detail.reload,
        conflict: '그사이 바뀐 대화예요. 최신 내용을 다시 읽었어요',
      },
    );

  /** 파일을 올려 결과물로 만들고 참조로 넣는다 (올린 파일은 보관함의 결과물이 된다) */
  async function upload(file: File): Promise<RefChoice | null> {
    const reply = await uploading.run('upload', () =>
      uploadFile<OutputSaved>(
        `/api/outputs/files?name=${encodeURIComponent(file.name)}`,
        file,
        'application/octet-stream',
      ),
    );
    if (!reply?.ok) return null;
    return {
      kind: 'output',
      id: reply.data.id,
      title: file.name,
      url: null,
      browser: false,
      // 사진은 서버가 앞부분으로 알아본 그림만 (이름으로 정한 SVG는 아니다)
      image: PHOTO_TYPES.includes(reply.data.mime),
    };
  }

  const tool = lead.data?.lead?.id === d.chat.agentId ? lead.data.lead.tool : null;
  const last = d.turns.at(-1);
  const asked =
    last?.brief && last.status === 'done' ? { taskId: last.taskId, brief: last.brief } : null;
  // 참조는 새 회차에만: 앞 회차가 끝나지 않았거나 맡기 전이면 덧붙인 말이라 받지 않는다 (서버 ChatHistory.waiting과 같은 규칙)
  const refsEnabled = !!partner && !TURN_OPEN.includes(d.turns.at(-1)?.status ?? '');

  const cancel = (taskId: string, version: number) =>
    cancelling.run(taskId, () => api('POST', `/api/tasks/${taskId}/cancel`, { version }), {
      done: '답을 멈췄어요',
      reload: detail.reload,
      conflict: '이미 바뀐 작업이에요. 최신 내용을 다시 읽었어요',
    });

  return (
    <div className="chat-split">
      <div className="chat-page">
        <header className="chat-top">
          <h1 className="clamp-1">{d.chat.title}</h1>
          {d.usage.tokens > 0 && (
            <small
              className="chat-tokens"
              title="이 대화의 일이 쓴 토큰 (설정 › AI 한도와 같은 수)"
            >
              토큰 {tokens(d.usage.tokens)}
            </small>
          )}
          {d.chat.deviceId && <span className="pill">기기에서</span>}
          {d.chat.appId && (
            <Link
              className="pill"
              href={`${STORE_HREF}/${d.chat.appId}?tab=team`}
              title="이 대화의 앱"
            >
              앱 · {apps.data?.apps.find((a) => a.id === d.chat.appId)?.name ?? '…'}
            </Link>
          )}
          {d.automations.map((a) => (
            <Link key={a.id} className="pill" href="/admin/schedules" title={a.title}>
              자동화 · {scheduleLabel(a)}
            </Link>
          ))}
          {tool && (
            <ChatRuntimeForm
              key={d.chat.version}
              tool={tool}
              model={d.chat.model}
              effort={d.chat.effort}
              busy={tuning.busy !== null}
              onSubmit={tune}
            />
          )}
          {(RUNNING.includes(d.state) || d.card) && (
            <button
              type="button"
              className="ghost small"
              disabled={stopping.busy !== null}
              onClick={stop}
            >
              {stopping.busy ? '멈추는 중' : '멈추기'}
            </button>
          )}
          <button
            type="button"
            className="ghost small"
            disabled={trashing.busy !== null}
            onClick={trash}
          >
            휴지통으로
          </button>
        </header>
        {detail.error && <p className="error">{detail.error}</p>}
        {stopping.problem && <p className="error">{stopping.problem}</p>}
        {trashing.problem && <p className="error">{trashing.problem}</p>}
        {tuning.problem && <p className="error">{tuning.problem}</p>}
        <ChatTurns
          chatId={d.chat.id}
          turns={d.turns}
          usage={d.usage.turns}
          news={d.news}
          pending={d.chat.pending}
          pendingRefs={d.chat.pendingRefs}
          me={me.data?.name ?? '관리자'}
          partner={partner?.name ?? null}
          deliver={d.chat.deliver}
          busy={cancelling.busy}
          onCancel={cancel}
          changing={sending.busy !== null || waking.busy !== null}
          onChangeDecision={changeDecision}
        />
        {waking.problem && <p className="error">{waking.problem}</p>}
        {cancelling.problem && <p className="error">{cancelling.problem}</p>}
        {/* 목표 확인 질문: 마지막 회차가 묻고 끝났으면 (답하면 다음 회차가 생겨 사라진다) */}
        {asked && (
          <ChatBriefForm
            key={asked.taskId}
            brief={asked.brief}
            busy={sending.busy !== null}
            onAnswer={(message) => send({ message })}
          />
        )}
        {d.card && (
          <ChatCardForm
            key={`${d.card.id}:${d.card.version}`}
            card={d.card}
            busy={deciding.busy !== null}
            problem={deciding.problem}
            onDecide={decide}
          />
        )}
        <ChatForm
          key={sent}
          busy={sending.busy !== null}
          problem={sending.problem ?? uploading.problem}
          blocked={blocked}
          hint={hint}
          refsEnabled={refsEnabled}
          onUpload={upload}
          onSubmit={send}
        />
        {/* 입력 칸 아래: 여기로 내리면 입력 칸이 마지막 말풍선을 가리지 않는다 */}
        <div ref={bottom} />
      </div>
      <ChatTeamPanel
        team={d.team}
        busy={hurrying.busy}
        problem={hurrying.problem}
        onHurry={hurry}
      />
    </div>
  );
}
