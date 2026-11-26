'use client';

import Link from 'next/link';
import { useState } from 'react';
import { pagePath } from '../../../_blog/format';
import { usePage } from '../../../_blog/live';
import type { PageDetail, PageRevision } from '../../../_blog/types';
import { api } from '../../../_lib/client-api';
import { useAction } from '../../../_lib/use-action';
import { when } from '../../../_task/labels';
import { usePageTasks } from '../../../_task/live';
import { TaskPill } from '../../../_task/parts';
import type { Task } from '../../../_task/types';
import { InstructionForm } from '../../../_ui/InstructionForm';
import { NewTabLink } from '../../../_ui/NewTabLink';
import { PageChangesPanel } from './PageChangesPanel';
import { PageEditForm } from './PageEditForm';

const CONFLICT = '이미 바뀐 페이지예요. 최신 내용을 다시 읽었어요';
/** 서버가 붙이는 격리와 같다 (틀에도 한 번 더): 페이지의 스크립트는 콘솔과 로그인에 닿지 못한다 */
const FRAME_SANDBOX =
  'allow-scripts allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-downloads';
const ENTRY = 'index.html';
// 공개 페이지는 브라우저가 60초 담아 둔다 (max-age): 보이는 판이 바뀌면 틀 주소에 판 번호를 붙여 새로 받는다

// 페이지 하나: 왼쪽에 지금 보이는 판, 오른쪽에 고쳐 달라는 입력 · 공개 · 판 목록.
// 고쳐 달라고 하면 만들기 작업이 서버에서 이 페이지의 가장 새 판을 받아 바뀐 파일만 낸다 (러너 page_base).
// 비공개 페이지는 새 판이 곧바로 보이고, 공개 페이지는 확인 대기로 남아 관리자가 미리 본 뒤 보인다.
// 앞 판은 남아서 되돌릴 수 있다. 판마다 data.json의 바뀐 점을 펼쳐 본다.
export function PageDetailPanel({ id }: { id: string }) {
  const page = usePage(id);
  const making = usePageTasks();
  const action = useAction();
  const save = useAction();
  const ask = useAction();
  const [editing, setEditing] = useState(false);
  const [opened, setOpened] = useState<number | null>(null);
  const p = page.data;
  const problem = action.problem ?? page.error ?? making.error;

  if (!p)
    return problem ? (
      <p className="error">{problem}</p>
    ) : (
      <p className="label-mono loading">불러오는 중…</p>
    );

  const path = pagePath(p.name);
  const fixing = making.tasks.filter((t) => t.page?.pageId === p.id);

  async function fix(shown: PageDetail, instruction: string, requestId: string) {
    const reply = await ask.run(
      'ask',
      () =>
        api<Task>('POST', '/api/tasks', {
          requestId,
          kind: 'make',
          instruction,
          page: { pageId: shown.id },
        }),
      { done: '작업 등록됨' },
    );
    return reply?.ok === true;
  }

  async function edit(shown: PageDetail, changes: { title: string; direction: string }) {
    const reply = await save.run(
      'edit',
      () => api('PATCH', `/api/pages/${shown.id}`, { version: shown.version, ...changes }),
      { done: '저장됨', reload: page.reload, conflict: CONFLICT },
    );
    if (reply?.ok) setEditing(false);
  }

  function toggle(shown: PageDetail) {
    const visibility = shown.visibility === 'public' ? 'private' : 'public';
    if (visibility === 'public' && !window.confirm('주소를 아는 누구나 보게 할까요?')) return;
    void action.run(
      'visibility',
      () => api('PATCH', `/api/pages/${shown.id}`, { version: shown.version, visibility }),
      {
        done: visibility === 'public' ? '공개로 바꿈' : '비공개로 바꿈',
        reload: page.reload,
        conflict: CONFLICT,
      },
    );
  }

  const show = (shown: PageDetail, seq: number) =>
    action.run(
      `seq:${seq}`,
      () => api('POST', `/api/pages/${shown.id}/current`, { version: shown.version, seq }),
      { done: `버전 ${seq} 보이는 중`, reload: page.reload, conflict: CONFLICT },
    );

  return (
    <>
      <header className="page-head">
        <div>
          <h1>{p.title}</h1>
          <p>
            <Link href="/admin/library/pages">페이지</Link> · /pages/{p.name}
          </p>
        </div>
        <div className="row">
          {!editing && (
            <button type="button" className="ghost" onClick={() => setEditing(true)}>
              편집
            </button>
          )}
          <NewTabLink className="ghost" href={path}>
            새 탭에서 열기
          </NewTabLink>
        </div>
      </header>
      {problem && <p className="error">{problem}</p>}
      {editing ? (
        <PageEditForm
          key={p.version}
          title={p.title}
          direction={p.direction}
          busy={save.busy !== null}
          problem={save.problem}
          onSubmit={(changes) => edit(p, changes)}
          onClose={() => {
            setEditing(false);
            save.clear();
          }}
        />
      ) : (
        p.direction && (
          <p className="note">
            <b>방향</b> {p.direction}
          </p>
        )
      )}
      {p.pendingSeq !== null && p.pendingPath && (
        <section className="panel" aria-label="확인 대기">
          <div className="plugin-head">
            <div>
              <b>버전 {p.pendingSeq} 확인 대기</b>
              <p>공개 페이지라 확인한 뒤에 보임. 방문자는 지금 버전 {p.currentSeq}을 봄</p>
            </div>
            <button
              type="button"
              className="cta small"
              disabled={action.busy !== null}
              onClick={() => show(p, p.pendingSeq as number)}
            >
              이 버전 보이기
            </button>
          </div>
          <iframe
            key={p.pendingPath}
            className="page-frame"
            title={`${p.title} 버전 ${p.pendingSeq}`}
            src={p.pendingPath}
            sandbox={FRAME_SANDBOX}
          />
        </section>
      )}
      <div className="page-work">
        <iframe
          key={`${p.currentSeq}:${p.updatedAt}`}
          className="page-frame"
          title={p.title}
          src={`${path}/${ENTRY}?v=${p.currentSeq}`}
          sandbox={FRAME_SANDBOX}
        />
        <div className="stack">
          <InstructionForm
            label="고칠 내용"
            placeholder="예: 둘째 날은 실내 코스로 바꿔 줘"
            submit="저장"
            hint={
              p.visibility === 'public'
                ? '끝나면 새 버전 · 공개 페이지라 확인한 뒤에 보임'
                : '끝나면 바로 새 버전 · 나만 봄'
            }
            busy={ask.busy !== null}
            problem={ask.problem}
            onSubmit={(instruction, requestId) => fix(p, instruction, requestId)}
            onEdit={ask.clear}
          />
          {fixing.length > 0 && (
            <ul className="list" aria-label="고치는 중">
              {fixing.map((t) => (
                <li key={t.id}>
                  <Link className="item" href={`/admin/tasks/${t.id}`}>
                    <div className="item-main">
                      <b>{t.title}</b>
                      <small>{t.lastEvent ?? when(t.createdAt)}</small>
                    </div>
                    <TaskPill status={t.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <section className="plugin" aria-label="공개">
            <div className="plugin-head">
              <div>
                <b>공개</b>
                <p>{p.visibility === 'public' ? '주소를 아는 누구나 봄' : '로그인한 나만 봄'}</p>
              </div>
              <button
                type="button"
                className="switch"
                role="switch"
                aria-checked={p.visibility === 'public'}
                aria-label="공개"
                disabled={action.busy !== null}
                onClick={() => toggle(p)}
              />
            </div>
          </section>
          <section aria-labelledby="page-revisions">
            <div className="sec-title">
              <h2 id="page-revisions">버전</h2>
            </div>
            <ul className="list">
              {p.revisionList.map((r: PageRevision) => (
                <li key={r.seq} className="list-cell schedule-row">
                  <div className="item-main">
                    <b>
                      버전 {r.seq}{' '}
                      {r.seq === p.currentSeq && <span className="pill on">보이는 버전</span>}
                      {r.seq === p.pendingSeq && <span className="pill">확인 대기</span>}
                    </b>
                    <small>
                      {when(r.createdAt)} · 파일 {r.files.length}개 ·{' '}
                      <Link href={`/admin/tasks/${r.taskId}`}>작업</Link>
                    </small>
                    {r.note && <small className="clamp">{r.note}</small>}
                  </div>
                  <div className="row">
                    <button
                      type="button"
                      className="ghost"
                      aria-expanded={opened === r.seq}
                      onClick={() => setOpened(opened === r.seq ? null : r.seq)}
                    >
                      바뀐 점
                    </button>
                    {r.seq !== p.currentSeq && (
                      <button
                        type="button"
                        className="ghost"
                        disabled={action.busy !== null}
                        onClick={() => show(p, r.seq)}
                      >
                        이 버전 보이기
                      </button>
                    )}
                  </div>
                  {opened === r.seq && (
                    <div className="page-changes-box">
                      <PageChangesPanel id={p.id} seq={r.seq} />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </>
  );
}
