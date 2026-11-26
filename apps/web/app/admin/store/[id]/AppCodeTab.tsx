'use client';

import Link from 'next/link';
import { type ChangeEvent, useRef } from 'react';
import { formatDate } from '../../../_blog/format';
import { CODE_SOURCE_LABELS } from '../../../_blog/labels';
import { useAppCode } from '../../../_blog/live';
import type { AdminApp, AppCode, AppCodeState } from '../../../_blog/types';
import { api, uploadFile } from '../../../_lib/client-api';
import { useAction } from '../../../_lib/use-action';
import { when } from '../../../_task/labels';
import { useAppCodeTasks } from '../../../_task/live';
import { TaskPill } from '../../../_task/parts';
import type { Task } from '../../../_task/types';
import { InstructionForm } from '../../../_ui/InstructionForm';
import { STORE_HREF } from '../../menu';

const CONFLICT = '이미 바뀐 앱이에요. 최신 내용을 다시 읽었어요';

const size = (bytes: number) =>
  bytes < 1024 ? `${bytes} B` : `${Math.round(bytes / 102.4) / 10} KB`;

// 앱 관리 › 코드 (스토어 1-6, 시안 9번): 이 앱만의 HTML · CSS · JS 묶음과 버전.
// 공개 앱의 새 버전(AI 작업 · zip 올리기 · 시작 코드로)은 확인 대기로 남고, 미리 본 뒤 "이 버전 공개"를 눌러야 방문자에게 보인다.
// 버전은 지우지 않고 쌓여 앞 버전으로 되돌릴 수 있다. 바깥 주소는 그 버전의 cairn.json이 정한다 (읽기만).
export function AppCodeTab({ app }: { app: AdminApp }) {
  const code = useAppCode(app.id);
  const action = useAction();
  const ask = useAction();
  const making = useAppCodeTasks(app.id);
  const zipInput = useRef<HTMLInputElement>(null);
  const c = code.data;
  const problem = action.problem ?? code.error ?? making.error;
  const base = `${STORE_HREF}/${app.id}/code`;
  const isPublic = app.visibility === 'public';

  if (!c)
    return problem ? (
      <p className="error">{problem}</p>
    ) : (
      <p className="label-mono loading">불러오는 중…</p>
    );

  const show = (shown: AppCode, seq: number) =>
    action.run(
      `seq:${seq}`,
      () =>
        api<AppCodeState>('POST', `/api/apps/${app.id}/code/current`, {
          version: shown.version,
          seq,
        }),
      { done: `버전 ${seq} 공개 중`, reload: code.reload, conflict: CONFLICT },
    );

  function starter(shown: AppCode) {
    if (!window.confirm('시작 코드를 새 버전으로 만들까요? 지금 버전은 기록에 남아요')) return;
    void action.run(
      'starter',
      () =>
        api<AppCodeState>('POST', `/api/apps/${app.id}/code/starter`, { version: shown.version }),
      { done: '시작 코드를 새 버전으로 만듦', reload: code.reload, conflict: CONFLICT },
    );
  }

  function upload(shown: AppCode, event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const note = encodeURIComponent(file.name.slice(0, 200));
    void action.run(
      'upload',
      () =>
        uploadFile<AppCodeState>(
          `/api/apps/${app.id}/code/versions?version=${shown.version}&note=${note}`,
          file,
          'application/zip',
        ),
      {
        done: isPublic ? '새 버전 · 확인 대기' : '새 버전 · 바로 보임',
        reload: code.reload,
        conflict: CONFLICT,
      },
    );
  }

  async function fix(instruction: string, requestId: string) {
    const reply = await ask.run(
      'ask',
      () =>
        api<Task>('POST', '/api/tasks', {
          requestId,
          kind: 'make',
          instruction,
          appCode: { appId: app.id },
        }),
      { done: '작업 등록됨' },
    );
    return reply?.ok === true;
  }

  const shownSeq = c.current ?? 0;
  return (
    <>
      {problem && <p className="error">{problem}</p>}
      {c.pending !== null && (
        <section className="panel" aria-label="확인 대기">
          <div className="plugin-head">
            <div>
              <b>버전 {c.pending} 확인 대기</b>
              <p>
                공개 앱이라 공개 전에 확인함. 방문자는 지금{' '}
                {c.current === null ? '시작 코드' : `버전 ${c.current}`}를 봄
              </p>
            </div>
            <div className="row">
              <Link className="ghost small" href={`${base}/${c.pending}`}>
                미리 보기
              </Link>
              <button
                type="button"
                className="cta small"
                disabled={action.busy !== null}
                onClick={() => show(c, c.pending as number)}
              >
                이 버전 공개
              </button>
            </div>
          </div>
        </section>
      )}
      <InstructionForm
        label="AI에게 맡기기"
        placeholder="예: 글 목록을 사진 카드 두 줄로, 제목은 명조로"
        submit="맡기기"
        hint={
          isPublic
            ? '만들기 작업 · 끝나면 새 버전 · 공개 전에 확인'
            : '만들기 작업 · 끝나면 바로 새 버전 · 비공개 앱'
        }
        busy={ask.busy !== null}
        problem={ask.problem}
        onSubmit={fix}
        onEdit={ask.clear}
      />
      {making.tasks.length > 0 && (
        <ul className="list" aria-label="고치는 중">
          {making.tasks.map((t) => (
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
      <section className="stack" aria-label="버전">
        <div className="row">
          <b>버전</b>
          <span className="spacer" />
          <input
            ref={zipInput}
            type="file"
            accept=".zip,application/zip"
            hidden
            onChange={(e) => upload(c, e)}
          />
          <button
            type="button"
            className="ghost small"
            disabled={action.busy !== null}
            onClick={() => zipInput.current?.click()}
          >
            zip 올리기
          </button>
          <a
            className="ghost small"
            href={`/api/apps/${app.id}/code/versions/${shownSeq}/zip`}
            download
          >
            내려받기
          </a>
        </div>
        <small className="note">zip은 20MB · 파일 100개 · 템플릿 하나에 1MB까지</small>
        <ul className="list">
          {c.versions.map((v) => (
            <li key={v.seq} className="list-cell app-row">
              <div className="item-main">
                <b>
                  버전 {v.seq}
                  {v.seq === c.current && ' · 공개 중'}
                  {v.seq === c.pending && ' · 확인 대기'}
                </b>
                <small>
                  {CODE_SOURCE_LABELS[v.source]} · {formatDate(v.createdAt)} · 파일 {v.fileCount}개
                  · {size(v.bytes)}
                  {v.note && ` · ${v.note}`}
                </small>
              </div>
              <div className="row">
                <Link className="ghost small" href={`${base}/${v.seq}`}>
                  미리 보기
                </Link>
                {v.seq !== c.current && v.seq !== c.pending && (
                  <button
                    type="button"
                    className="ghost small"
                    disabled={action.busy !== null}
                    onClick={() => show(c, v.seq)}
                  >
                    이 버전으로 되돌리기
                  </button>
                )}
              </div>
            </li>
          ))}
          <li className="list-cell app-row">
            <div className="item-main">
              <b>시작 코드{c.current === null && ' · 공개 중'}</b>
              <small>앱 종류의 기본 코드. 처음 고치면 그 위에 버전 1이 생김</small>
            </div>
            <div className="row">
              <Link className="ghost small" href={`${base}/0`}>
                미리 보기
              </Link>
              {c.versions.length > 0 && (
                <button
                  type="button"
                  className="ghost small"
                  disabled={action.busy !== null}
                  onClick={() => starter(c)}
                >
                  시작 코드로
                </button>
              )}
            </div>
          </li>
        </ul>
      </section>
      <section className="stack" aria-label="지금 코드의 파일">
        <b>{c.current === null ? '시작 코드의 파일' : `버전 ${c.current}의 파일`}</b>
        <ul className="list">
          {c.files.map((f) => (
            <li key={f.name} className="list-cell app-row">
              <span className="item-main label-mono">{f.name}</span>
              <small>{size(f.sizeBytes)}</small>
            </li>
          ))}
        </ul>
        <b>바깥 주소</b>
        <p className="note">
          {c.hosts.length === 0
            ? '이 사이트만 (바꾸려면 cairn.json의 hosts를 고친 새 버전)'
            : `${c.hosts.join(' · ')} (바꾸려면 cairn.json을 고친 새 버전)`}
        </p>
      </section>
    </>
  );
}
