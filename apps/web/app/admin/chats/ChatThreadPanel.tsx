'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useMe } from '../../_account/live';
import { useApps } from '../../_blog/live';
import { api, uploadFile } from '../../_lib/client-api';
import { useAction } from '../../_lib/use-action';
import { useLiveValue } from '../../_lib/use-live';
import { scheduleLabel, tokens } from '../../_task/labels';
import { CHAT_DETAIL_TOPICS, useLead } from '../../_task/live';
import type { Chat, ChatDetail, OutputSaved } from '../../_task/types';
import { STORE_HREF } from '../menu';
import { ChatCardForm } from './ChatCardForm';
import { ChatForm, type ChatMessageBody } from './ChatForm';
import type { RefChoice } from './ChatRefs';
import { ChatRuntimeForm } from './ChatRuntimeForm';
import { ChatTeamPanel } from './ChatTeamPanel';
import { ChatTurns } from './ChatTurns';

/** 도는 상태 (멈추기가 보인다) */
const RUNNING = ['working'];
/** 끝나지 않은 회차 작업의 상태 (이때 보내면 덧붙인 말) */
const TURN_OPEN = ['queued', 'running', 'waiting'];

// 대화 하나 (2차 1-5, ChatGPT · Claude 같은 모양): 가운데 주고받음, 아래 입력 칸 하나.
// 팀이 일하는 동안에는 오른쪽에 "팀이 동시에 일하는 중" 칸이 붙는다 (ChatTeamPanel, 좁은 화면에서는 숨긴다).
// 상대는 늘 대표 (O-2): 대표가 팀에 나눠 맡기고, 승인은 결과 카드 하나로 정한다 (2차 2단계).
// 일하는 중에도 보낸다: 덧붙인 말이 되고 대표가 짧게 답한다 (2차 1-1). 신호가 오면 다시 읽는다
export function ChatThreadPanel({ id }: { id: string }) {
  // 대상(id)으로 거르지 않는다: 신호의 대상은 회차 작업 · 승인이라 대화 id가 아니다
  const detail = useLiveValue(
    `chat:${id}`,
    () => api<ChatDetail>('GET', `/api/chats/${id}`),
    CHAT_DETAIL_TOPICS,
  );
  const me = useMe();
  const apps = useApps();
  const sending = useAction();
  const cancelling = useAction();
  const deciding = useAction();
  const stopping = useAction();
  const tuning = useAction();
  const uploading = useAction();
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

  async function send(body: ChatMessageBody) {
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
    if (!reply?.ok) return;
    requestId.current = crypto.randomUUID();
    setSent((n) => n + 1);
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

  const stop = () =>
    stopping.run('stop', () => api('POST', `/api/chats/${id}/stop`, { version: d.chat.version }), {
      done: '멈췄어요',
      reload: detail.reload,
      conflict: '그사이 바뀐 대화예요. 최신 내용을 다시 읽었어요',
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
      image: reply.data.kind === 'image',
    };
  }

  const tool = lead.data?.lead?.id === d.chat.agentId ? lead.data.lead.tool : null;
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
        </header>
        {detail.error && <p className="error">{detail.error}</p>}
        {stopping.problem && <p className="error">{stopping.problem}</p>}
        {tuning.problem && <p className="error">{tuning.problem}</p>}
        <ChatTurns
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
        />
        {cancelling.problem && <p className="error">{cancelling.problem}</p>}
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
      <ChatTeamPanel team={d.team} />
    </div>
  );
}
