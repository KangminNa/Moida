'use client';

import { useApps } from '../../_blog/live';
import type { SavedPost } from '../../_blog/types';
import { api } from '../../_lib/client-api';
import { useAction } from '../../_lib/use-action';
import type { LinkedPost } from './post-settings';

const CONFLICT = '다른 곳에서 먼저 고쳤어요. 다시 불러온 뒤 골라 주세요';

// 글이 든 앱 (스토어 1-5, 편집기의 발행 창): 앱에 든 글만 공개 · 링크 공개할 수 있다.
// 저장한 글은 고르면 바로 옮긴다 (POST /api/posts/:id/menu, 메뉴에서는 빠진다: 메뉴는 앱 안에 있다).
// 아직 저장하지 않은 새 글은 고른 앱을 들고 있다가 첫 저장에 함께 보낸다 (pending · onPick)
export function PostAppField({
  post,
  pending,
  onPick,
  onMoved,
}: {
  post: LinkedPost | null;
  pending: string | null;
  onPick: (appId: string | null) => void;
  onMoved: (post: SavedPost) => void;
}) {
  const apps = useApps();
  const action = useAction();

  async function move(appId: string | null) {
    if (!post) return onPick(appId);
    const reply = await action.run(
      'app',
      () =>
        api<SavedPost>('POST', `/api/posts/${post.id}/menu`, {
          version: post.version,
          menuId: null,
          appId,
        }),
      { done: appId ? '앱에 넣음' : '앱에서 뺌', conflict: CONFLICT },
    );
    if (reply?.ok) onMoved(reply.data);
  }

  return (
    <label className="field">
      <span>앱</span>
      <select
        className="input"
        value={(post ? post.appId : pending) ?? ''}
        disabled={action.busy !== null}
        onChange={(e) => void move(e.target.value || null)}
      >
        <option value="">앱 밖 (공개할 수 없음)</option>
        {apps.data?.apps.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name} · /{a.slug}
          </option>
        ))}
      </select>
      <small>앱을 바꾸면 메뉴에서 빠짐</small>
      {action.problem && <span className="error">{action.problem}</span>}
    </label>
  );
}
