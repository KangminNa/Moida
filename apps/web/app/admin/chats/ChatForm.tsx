'use client';

import {
  type ChangeEvent,
  type ClipboardEvent,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
  useRef,
  useState,
} from 'react';
import { Icon } from '../../_ui/Icon';
import { RefChips, type RefChoice, RefPicker } from './ChatRefs';
import { PHOTO_TYPES, pickPhotos } from './chat-photos';

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
// 사진 (대화에 사진 넣기 ②-c): 사진 단추 · 붙여 넣기 · 끌어다 놓기. 패널이 결과물로 올려(onUpload) 참조로 붙고
// 미리보기로 보인다. 한 메시지에 4장 · 장당 10MB · PNG · JPEG · WebP · GIF (chat-photos.ts의 pickPhotos)
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
  /** 올리는 중인 사진 장수 (그동안 보내지 않는다: 보내면 사진이 빠진다) */
  const [waiting, setWaiting] = useState(0);
  /** 넣지 못한 사진의 까닭 (형식 · 크기 · 장수) */
  const [photoProblem, setPhotoProblem] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const photoInput = useRef<HTMLInputElement>(null);
  const locked = busy || blocked !== null;
  const photosOn = refsEnabled && onUpload !== null && !locked;

  function send(e?: FormEvent) {
    e?.preventDefault();
    const text = message.trim();
    if (!text || locked || waiting > 0) return;
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

  /** 사진을 하나씩 올려 참조로 붙인다 (올리는 동작 하나씩: 패널의 useAction은 한 번에 하나) */
  async function addPhotos(files: readonly File[]) {
    if (files.length === 0 || !onUpload) return;
    if (!photosOn)
      return setPhotoProblem('지금은 사진을 넣지 못해요 (일하는 중이면 다음 메시지에)');
    const already = refs.filter((r) => r.image).length + waiting;
    const { photos, problem } = pickPhotos(files, already);
    setPhotoProblem(problem);
    setWaiting((n) => n + photos.length);
    for (const file of photos) {
      const ref = await onUpload(file);
      setWaiting((n) => n - 1);
      if (ref) pick(ref);
    }
  }

  function choosePhotos(e: ChangeEvent<HTMLInputElement>) {
    const files = [...(e.target.files ?? [])];
    e.target.value = '';
    void addPhotos(files);
  }

  /** 붙여 넣은 사진 (화면 캡처). 글이 함께 있으면 글은 그대로 붙는다 */
  function paste(e: ClipboardEvent<HTMLTextAreaElement>) {
    const files = [...e.clipboardData.files].filter((f) => f.type.startsWith('image/'));
    if (files.length === 0) return;
    if (!e.clipboardData.types.includes('text/plain')) e.preventDefault();
    void addPhotos(files);
  }

  function dragOver(e: DragEvent<HTMLFieldSetElement>) {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    setDragging(true);
  }

  function drop(e: DragEvent<HTMLFieldSetElement>) {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    setDragging(false);
    void addPhotos([...e.dataTransfer.files]);
  }

  return (
    <form className="chat-compose" onSubmit={send}>
      {blocked ? <p className="note">{blocked}</p> : hint && <p className="note">{hint}</p>}
      {problem && (
        <p className="error" role="alert">
          {problem}
        </p>
      )}
      {photoProblem && (
        <p className="error" role="alert">
          {photoProblem}
        </p>
      )}
      {refsEnabled && (
        <RefChips
          refs={refs}
          waiting={waiting}
          onRemove={(i) => setRefs((r) => r.filter((_, at) => at !== i))}
        />
      )}
      {refsEnabled && picking && (
        <RefPicker onPick={pick} onUpload={onUpload} onClose={() => setPicking(false)} />
      )}
      {/* 입력 상자: 위는 글, 아래는 도구 줄 (참조 넣기 · 사진 · 보내기). 사진을 끌어다 놓을 수 있다 */}
      <fieldset
        aria-label="메시지 입력"
        className={dragging ? 'chat-box dropping' : 'chat-box'}
        onDragOver={dragOver}
        onDragLeave={() => setDragging(false)}
        onDrop={drop}
      >
        <textarea
          className="chat-box-input"
          aria-label="메시지"
          placeholder={
            refsEnabled
              ? '맡길 일을 적어요 (+ 단추나 @로 위키 · 파일 · 주소 넣기)'
              : '메시지 (Enter로 보내기, Shift+Enter로 줄 바꿈)'
          }
          rows={rows}
          maxLength={MESSAGE_MAX}
          value={message}
          disabled={blocked !== null}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={keys}
          onPaste={paste}
        />
        <div className="chat-box-tools">
          {refsEnabled && (
            <button
              type="button"
              className="round-button"
              aria-label="참조 넣기"
              aria-expanded={picking}
              disabled={locked}
              onClick={() => setPicking(!picking)}
            >
              <Icon name="plus" />
            </button>
          )}
          {refsEnabled && onUpload && (
            <button
              type="button"
              className="round-button"
              aria-label="사진 넣기"
              disabled={!photosOn}
              onClick={() => photoInput.current?.click()}
            >
              <Icon name="photo" />
            </button>
          )}
          <input
            ref={photoInput}
            type="file"
            accept={PHOTO_TYPES.join(',')}
            multiple
            hidden
            onChange={choosePhotos}
          />
          <button
            type="submit"
            className="round-button send"
            aria-label={busy ? '보내는 중' : waiting > 0 ? '사진 올리는 중' : '보내기'}
            disabled={locked || waiting > 0 || !message.trim()}
          >
            <Icon name="up" />
          </button>
        </div>
      </fieldset>
    </form>
  );
}
