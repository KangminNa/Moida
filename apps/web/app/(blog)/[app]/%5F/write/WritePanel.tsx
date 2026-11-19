'use client';

import { useState } from 'react';
import { memberApi } from '../../../../_community/member-api';
import { newRequestId } from '../../../../_community/request-id';
import type { TopicDetail, TopicSaved } from '../../../../_community/types';
import { useAction } from '../../../../_lib/use-action';

// 글 쓰기 · 고치기 · 지우기. 본문은 마크다운이고 화면에서 거른 HTML로 그린다 (바깥 링크는 nofollow ugc).
// 만들기는 requestId를 함께 보내 응답을 못 받아 다시 눌러도 글이 하나만 생긴다. 고치기 · 지우기는 본 version을 보낸다
export function WritePanel({
  csrf,
  topic,
  notice,
}: {
  csrf: string | null;
  topic: TopicDetail | null;
  notice: string | null;
}) {
  const [title, setTitle] = useState(topic?.title ?? '');
  const [body, setBody] = useState(topic?.body ?? '');
  const [requestId] = useState(newRequestId);
  const save = useAction();
  const remove = useAction();
  const busy = save.busy !== null || remove.busy !== null;
  const conflict = '다른 곳에서 고쳤어요. 화면을 새로 고친 뒤 다시 해 주세요';

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const reply = await save.run(
      'save',
      () =>
        topic
          ? memberApi<TopicSaved>(csrf, 'PATCH', `topics/${topic.id}`, {
              version: topic.version,
              title,
              body,
            })
          : memberApi<TopicSaved>(csrf, 'POST', 'topics', { requestId, title, body }),
      { conflict },
    );
    if (reply?.ok) window.location.replace(`/t/${reply.data.id}`);
  }

  async function erase() {
    if (!topic || !window.confirm('이 글을 지울까요? 댓글도 함께 보이지 않아요')) return;
    const reply = await remove.run(
      'remove',
      () => memberApi(csrf, 'DELETE', `topics/${topic.id}`, { version: topic.version }),
      { conflict },
    );
    if (reply?.ok) window.location.replace('/');
  }

  return (
    <form className="member-form" onSubmit={submit}>
      {notice && <p className="note">{notice}</p>}
      <label className="field">
        <span>제목</span>
        <input
          className="input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={100}
          required
        />
      </label>
      <label className="field">
        <span>본문</span>
        <textarea
          className="input member-body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={12}
          required
        />
        <small>마크다운을 쓸 수 있어요. 링크는 5개까지</small>
      </label>
      {save.problem && <p className="error">{save.problem}</p>}
      {remove.problem && <p className="error">{remove.problem}</p>}
      <div className="member-actions">
        <button className="cta" type="submit" disabled={busy || !!notice || !title || !body}>
          {save.busy ? '올리는 중' : topic ? '고치기' : '올리기'}
        </button>
        <a className="ghost" href={topic ? `/t/${topic.id}` : '/'}>
          취소
        </a>
        {topic && (
          <button className="ghost danger" type="button" onClick={erase} disabled={busy}>
            {remove.busy ? '지우는 중' : '삭제'}
          </button>
        )}
      </div>
    </form>
  );
}
