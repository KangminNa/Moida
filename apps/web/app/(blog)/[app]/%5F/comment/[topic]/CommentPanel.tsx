'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { formatDate } from '../../../../../_blog/format';
import { memberApi } from '../../../../../_community/member-api';
import type { TopicDetail } from '../../../../../_community/types';
import { useAction } from '../../../../../_lib/use-action';

// 댓글 달기와 이 글에 단 내 댓글 지우기. 댓글은 고치지 않는다 (1차). 지우면 서버에서 다시 그려 목록을 맞춘다
export function CommentPanel({
  csrf,
  topic,
  notice,
}: {
  csrf: string | null;
  topic: TopicDetail;
  notice: string | null;
}) {
  const router = useRouter();
  const [body, setBody] = useState('');
  const [requestId] = useState(() => crypto.randomUUID());
  const write = useAction();
  const remove = useAction();
  const mine = topic.comments.filter((c) => c.mine);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const reply = await write.run('write', () =>
      memberApi(csrf, 'POST', `topics/${topic.id}/comments`, { requestId, body }),
    );
    if (reply?.ok) window.location.replace(`/t/${topic.id}`);
  }

  async function erase(id: string, version: number | undefined) {
    if (!window.confirm('이 댓글을 지울까요?')) return;
    await remove.run(id, () => memberApi(csrf, 'DELETE', `comments/${id}`, { version }), {
      reload: () => router.refresh(),
    });
  }

  return (
    <div className="member-form">
      <p className="member-hint">
        <a href={`/t/${topic.id}`}>← {topic.title}</a>
      </p>
      <form className="member-form" onSubmit={submit}>
        {notice && <p className="note">{notice}</p>}
        <label className="field">
          <span>댓글</span>
          <textarea
            className="input"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={4}
            maxLength={2000}
            required
          />
          <small>글자 그대로 보여요. 링크는 2개까지</small>
        </label>
        {write.problem && <p className="error">{write.problem}</p>}
        <button className="cta" type="submit" disabled={write.busy !== null || !!notice || !body}>
          {write.busy ? '다는 중' : '댓글 달기'}
        </button>
      </form>
      {mine.length > 0 && (
        <section aria-label="내 댓글">
          <h2 className="member-sub">이 글에 단 내 댓글</h2>
          <ul className="member-comments">
            {mine.map((c) => (
              <li key={c.id}>
                <p>{c.body}</p>
                <div className="member-actions">
                  <time dateTime={c.createdAt}>{formatDate(c.createdAt)}</time>
                  <button
                    className="ghost danger"
                    type="button"
                    onClick={() => erase(c.id, c.version)}
                    disabled={remove.busy !== null}
                  >
                    {remove.busy === c.id ? '지우는 중' : '삭제'}
                  </button>
                </div>
              </li>
            ))}
          </ul>
          {remove.problem && <p className="error">{remove.problem}</p>}
        </section>
      )}
    </div>
  );
}
