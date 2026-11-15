'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { AdminPostList, Issue, IssueDetail, IssueList, MenuList } from '../../../_blog/types';
import { api } from '../../../_lib/client-api';
import { useAction } from '../../../_lib/use-action';
import { useLiveValue } from '../../../_lib/use-live';
import { IssueForm } from './IssueForm';
import { IssuePostsForm } from './IssuePostsForm';

const CONFLICT = '이미 바뀐 호예요. 최신 내용을 다시 읽었어요';
const NO_TOPICS: readonly string[] = [];
const STATUS: Record<string, string> = { draft: '만드는 중', published: '발행' };

// 매거진 호 (2차 6단계): 호 목록 메뉴 하나의 호를 새 번호부터. 추가 · 글 고르기 · 발행 · 삭제(발행 전만).
// 발행은 호와 그 글을 한 번에 공개한다. AI 팀이 만든 호는 결과 카드의 승인(blog.issue.publish)로도 나간다.
export function MenuIssuesPanel({ menuId }: { menuId: string }) {
  const menus = useLiveValue('menus', () => api<MenuList>('GET', '/api/menus'), NO_TOPICS);
  const issues = useLiveValue('issues', () => api<IssueList>('GET', '/api/issues'), NO_TOPICS);
  const posts = useLiveValue(
    'draft-posts',
    () => api<AdminPostList>('GET', '/api/posts?status=draft'),
    NO_TOPICS,
  );
  const add = useAction();
  const action = useAction();
  const [open, setOpen] = useState<IssueDetail | null>(null);
  const menu = menus.data?.menus.find((m) => m.id === menuId) ?? null;
  const list = issues.data?.issues.filter((i) => i.menuId === menuId) ?? null;
  const problem = action.problem ?? issues.error ?? menus.error;
  const reload = () => Promise.all([issues.reload(), posts.reload()]);

  async function create(body: { title: string; intro: string | null }, requestId: string) {
    const reply = await add.run(
      'add',
      () => api('POST', '/api/issues', { ...body, menuId, requestId }),
      { done: `${body.title} 추가`, reload },
    );
    return reply?.ok === true;
  }

  function choose(issue: Issue) {
    void action.run(
      `posts:${issue.id}`,
      async () => {
        const reply = await api<IssueDetail>('GET', `/api/issues/${issue.id}`);
        if (reply.ok) setOpen(reply.data);
        return reply;
      },
      {},
    );
  }

  async function savePosts(issue: IssueDetail, postIds: readonly string[]) {
    const reply = await action.run(
      `save:${issue.id}`,
      () => api('POST', `/api/issues/${issue.id}/posts`, { version: issue.version, postIds }),
      { done: '호의 글 저장', reload, conflict: CONFLICT },
    );
    if (reply?.ok) setOpen(null);
  }

  function publish(issue: Issue) {
    if (!window.confirm(`${issue.number}호와 그 글 ${issue.posts}개를 모두 공개할까요?`)) return;
    void action.run(
      `publish:${issue.id}`,
      () => api('POST', `/api/issues/${issue.id}/publish`, { version: issue.version }),
      { done: `${issue.number}호 발행`, reload, conflict: CONFLICT },
    );
  }

  function remove(issue: Issue) {
    if (!window.confirm(`${issue.number}호를 지울까요? 든 글은 그대로 남아요`)) return;
    void action.run(
      `delete:${issue.id}`,
      () => api('POST', `/api/issues/${issue.id}/delete`, { version: issue.version }),
      { done: `${issue.number}호 삭제`, reload, conflict: CONFLICT },
    );
  }

  return (
    <>
      <header className="page-head">
        <div>
          <h1>{menu ? `${menu.name} 호` : '호'}</h1>
          <p>
            <Link href="/admin/menus">메뉴</Link> · 발행은 호와 그 글을 한 번에 공개
          </p>
        </div>
      </header>
      {problem && <p className="error">{problem}</p>}
      <IssueForm
        busy={add.busy !== null}
        problem={add.problem}
        onSubmit={create}
        onEdit={add.clear}
      />
      {list === null ? (
        !problem && <p className="label-mono">불러오는 중…</p>
      ) : list.length === 0 ? (
        <p className="rows-empty">호 없음</p>
      ) : (
        <ul className="list" aria-label="호">
          {list.map((i) => (
            <li key={i.id} className="list-cell schedule-row">
              <div className="item-main">
                <b>
                  {i.number}호 · {i.title}{' '}
                  <span className="pill">{STATUS[i.status] ?? i.status}</span>
                </b>
                <small>
                  글 {i.posts}개{i.intro ? ` · ${i.intro}` : ''}
                </small>
              </div>
              {i.status === 'draft' && (
                <div className="row">
                  <button
                    type="button"
                    className="ghost"
                    disabled={action.busy !== null}
                    onClick={() => choose(i)}
                  >
                    글 고르기
                  </button>
                  <button
                    type="button"
                    className="ghost"
                    disabled={action.busy !== null}
                    onClick={() => publish(i)}
                  >
                    발행
                  </button>
                  <button
                    type="button"
                    className="ghost"
                    disabled={action.busy !== null}
                    onClick={() => remove(i)}
                  >
                    삭제
                  </button>
                </div>
              )}
              {open?.id === i.id && (
                <div className="page-changes-box">
                  <IssuePostsForm
                    issueId={i.id}
                    posts={posts.data?.posts ?? []}
                    chosen={open.postList.map((p) => p.id)}
                    busy={action.busy !== null}
                    problem={action.problem}
                    onSubmit={(ids) => savePosts(open, ids)}
                    onClose={() => setOpen(null)}
                  />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
