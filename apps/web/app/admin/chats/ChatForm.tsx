'use client';

import { type FormEvent, type KeyboardEvent, useState } from 'react';
import { RefChips, type RefChoice, RefPicker } from './ChatRefs';

/** 메시지 한 개의 길이 (서버 Chat.MESSAGE_MAX) */
const MESSAGE_MAX = 8000;
/** 참조는 회차마다 이만큼 (서버 TaskRefs.MAX) */
const REFS_MAX = 10;

/** 보낼 본문: 메시지와 참조 (보관함은 종류 · id, 주소는 url · 서버 브라우저로) */
export type ChatMessageBody = {
  message: string;
  refs?: ({ kind: string; id: string | null } | { kind: 'url'; url: string; browser: boolean })[];
};

// 대화 안의 메시지 입력 칸. Enter로 보내고 Shift+Enter로 줄을 바꾼다 (한글 조합 중의 Enter는 보내지 않는다).
// 일하는 중에도 보낸다: 그 회차에 덧붙인 말이 된다 (2차 1-1). 보낸 뒤 칸을 비우는 것은 패널이 key로 폼을 새로 만들어서.
// 새 대화(ChatNewPanel)와 대화 하나(ChatThreadPanel)가 함께 쓴다 (2차 1-5: 입력은 하나).
// 참조 넣기 (2026-11-15 B): + 단추나 @를 치면 고르기 칸이 열린다. 새 회차에만 (일하는 중 · 맡기 전에는 refs가 꺼진다)
export function ChatForm({
  busy,
  problem,
  blocked,
  hint,
  rows = 2,
  refsEnabled = false,
  onUpload = null,
  onSubmit,
}: {
  busy: boolean;
  problem: string | null;
  /** 보낼 수 없는 까닭 (상대가 바뀜 등). 있으면 칸을 잠근다 */
  blocked: string | null;
  /** 보내면 어떻게 되는지 (일하는 중이면 덧붙인 말) */
  hint: string | null;
  /** 입력 칸의 처음 줄 수 (새 대화는 크게) */
  rows?: number;
  /** 참조를 넣을 수 있는가 (새 회차가 될 때) */
  refsEnabled?: boolean;
  /** 파일을 올려 결과물 참조로 (패널이 올린다) */
  onUpload?: ((file: File) => Promise<RefChoice | null>) | null;
  onSubmit: (body: ChatMessageBody) => void;
}) {
  const [message, setMessage] = useState('');
  const [refs, setRefs] = useState<RefChoice[]>([]);
  const [picking, setPicking] = useState(false);
  const locked = busy || blocked !== null;

  function send(e?: FormEvent) {
    e?.preventDefault();
    const text = message.trim();
    if (!text || locked) return;
    const body: ChatMessageBody['refs'] = refs.map((r) =>
      r.kind === 'url'
        ? { kind: 'url', url: r.url ?? '', browser: r.browser }
        : { kind: r.kind, id: r.id },
    );
    onSubmit(refsEnabled && body.length > 0 ? { message: text, refs: body } : { message: text });
  }

  function keys(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === '@' && refsEnabled && /(^|\s)$/.test(message)) setPicking(true);
    if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return;
    e.preventDefault();
    send();
  }

  function pick(ref: RefChoice) {
    setRefs((before) =>
      before.length >= REFS_MAX ||
      before.some((r) => r.kind === ref.kind && (r.id ?? r.url) === (ref.id ?? ref.url))
        ? before
        : [...before, ref],
    );
  }

  return (
    <form className="chat-compose" onSubmit={send}>
      {blocked ? <p className="note">{blocked}</p> : hint && <p className="note">{hint}</p>}
      {problem && (
        <p className="error" role="alert">
          {problem}
        </p>
      )}
      {refsEnabled && (
        <RefChips refs={refs} onRemove={(i) => setRefs((r) => r.filter((_, at) => at !== i))} />
      )}
      {refsEnabled && picking && (
        <RefPicker onPick={pick} onUpload={onUpload} onClose={() => setPicking(false)} />
      )}
      <div className="chat-compose-row">
        {refsEnabled && (
          <button
            type="button"
            className="icon-button"
            aria-label="참조 넣기"
            aria-expanded={picking}
            disabled={locked}
            onClick={() => setPicking(!picking)}
          >
            +
          </button>
        )}
        <textarea
          className="input"
          aria-label="메시지"
          placeholder={
            refsEnabled
              ? '메시지 (+ 단추나 @로 위키 · 파일 · 주소 넣기, Enter로 보내기)'
              : '메시지 (Enter로 보내기, Shift+Enter로 줄 바꿈)'
          }
          rows={rows}
          maxLength={MESSAGE_MAX}
          value={message}
          disabled={blocked !== null}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={keys}
        />
        <button type="submit" className="cta small" disabled={locked || !message.trim()}>
          {busy ? '보내는 중' : '보내기'}
        </button>
      </div>
    </form>
  );
}
