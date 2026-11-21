'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { formatDate } from '../../../_blog/format';
import { POST_STATUS_LABELS } from '../../../_blog/labels';
import type { AdminApp, AdminPostList } from '../../../_blog/types';
import { api } from '../../../_lib/client-api';
import { useAction } from '../../../_lib/use-action';
import { useLiveValue } from '../../../_lib/use-live';
import { CHAT_NEEDS_ME, CHAT_STATE } from '../../../_task/labels';
import { useAppChats } from '../../../_task/live';
import type { Chat } from '../../../_task/types';
import { InstructionForm } from '../../../_ui/InstructionForm';
import { CHATS_HREF, STORE_HREF } from '../../menu';

const POST_TOPICS = ['blog.post.*'];
const RECENT = 5;

// 앱 관리 › 개요 (스토어 1-5): 든 것의 수와 최근에 고친 글 다섯. 이 앱의 대화(승인 대기 · 일하는 중, 스토어 2단계)와
// 이 앱에 맡기기 (앱을 가진 대화를 연다: 대표가 받아 일꾼에게 맡긴다, 2026-11-21 개요로 옮김)
export function AppOverview({ app }: { app: AdminApp }) {
  const router = useRouter();
  const ask = useAction();
  const chats = useAppChats(app.id);
  const talks = chats.data?.chats.slice(0, RECENT) ?? null;
  const posts = useLiveValue(
    `app-posts:${app.slug}`,
    () => api<AdminPostList>('GET', `/api/posts?app=${encodeURIComponent(app.slug)}`),
    POST_TOPICS,
  );
  const c = app.counts;
  const recent = posts.data?.posts.slice(0, RECENT) ?? null;
  // 커뮤니티(스토어 3-2)의 글 · 회원은 커뮤니티 탭에서 본다 (블로그 글 · 메뉴가 없다)
  const blogLike = app.kind === 'blog' || app.kind === 'magazine';
  const counts: readonly [string, number | undefined][] =
    app.kind === 'community'
      ? []
      : app.kind === 'page'
        ? [['페이지', c?.pages]]
        : [
            ['공개 글', c?.published],
            ['초안', c?.drafts],
            ['메뉴', c?.menus],
            ['페이지', c?.pages],
          ];

  async function send(message: string, requestId: string) {
    const reply = await ask.run('ask', () =>
      api<Chat>('POST', '/api/chats', { requestId, message, appId: app.id }),
    );
    if (!reply?.ok) return false;
    router.push(`${CHATS_HREF}/${reply.data.id}`);
    return true;
  }

  return (
    <>
      <InstructionForm
        label="이 앱에 맡기기"
        placeholder={`예: ${app.name}에 이번 주 글 하나 써 줘`}
        submit="맡기기"
        hint="대표가 받아 일꾼에게 맡기고, 결과는 대화의 카드로"
        busy={ask.busy !== null}
        problem={ask.problem}
        onSubmit={send}
        onEdit={ask.clear}
      />
      <p className="row">
        <Link className="ghost small" href={`${STORE_HREF}/${app.id}/code/live`}>
          {app.visibility === 'public' ? '미리 보기' : '미리 보기 (비공개 앱)'}
        </Link>
      </p>
      <section className="stack" aria-label="이 앱의 대화">
        <b>이 앱의 대화</b>
        {chats.error && <p className="error">{chats.error}</p>}
        {talks === null ? (
          !chats.error && <p className="label-mono">불러오는 중…</p>
        ) : talks.length === 0 ? (
          <p className="rows-empty">아직 대화 없음 · 위에서 맡기기</p>
        ) : (
          <ul className="list">
            {talks.map((c) => (
              <li key={c.id} className="list-cell">
                <Link className="item-main" href={`${CHATS_HREF}/${c.id}`}>
                  <b className="clamp-1">{c.title}</b>
                  <small>
                    {formatDate(c.updatedAt)}{' '}
                    <span className={CHAT_NEEDS_ME.includes(c.state) ? 'pill on' : 'pill'}>
                      {CHAT_STATE[c.state] ?? c.state}
                    </span>
                  </small>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
      {app.kind === 'community' && (
        <p className="row">
          <Link className="ghost small" href={`${STORE_HREF}/${app.id}?tab=community`}>
            신고 · 글 · 회원 보기
          </Link>
        </p>
      )}
      <ul className="app-counts" aria-label="든 것의 수" hidden={counts.length === 0}>
        {counts.map(([label, n]) => (
          <li key={label} className="panel">
            <b>{n ?? '–'}</b>
            <small>{label}</small>
          </li>
        ))}
      </ul>
      {blogLike && (
        <section className="stack" aria-label="최근 글">
          <div className="row">
            <b>최근 글</b>
            <Link className="ghost small" href={`${STORE_HREF}/${app.id}?tab=posts`}>
              모두 보기
            </Link>
          </div>
          {posts.error && <p className="error">{posts.error}</p>}
          {recent === null ? (
            !posts.error && <p className="label-mono">불러오는 중…</p>
          ) : recent.length === 0 ? (
            <p className="rows-empty">이 앱의 글 없음</p>
          ) : (
            <ul className="list">
              {recent.map((p) => (
                <li key={p.id} className="list-cell">
                  <Link className="item-main" href={`/admin/posts/${p.id}`}>
                    <b>{p.title || '제목 없음'}</b>
                    <small>
                      {POST_STATUS_LABELS[p.status]} · {formatDate(p.updatedAt)}
                    </small>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </>
  );
}
