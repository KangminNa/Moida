'use client';

import { useState } from 'react';
import type { AdminApp } from '../../../_blog/types';
import type { AppRowPage, AppTableLine, AppTableList } from '../../../_community/types';
import { api } from '../../../_lib/client-api';
import { useAction } from '../../../_lib/use-action';
import { useLiveValue } from '../../../_lib/use-live';
import { AppDataForm } from './AppDataForm';

const RULES: Record<string, string> = {
  anyone: '누구나',
  member: '회원',
  owner: '쓴 회원',
  admin: '관리자',
};
/** 앱의 버전이 바뀌면 표가 바뀐다 */
const TOPICS: readonly string[] = ['blog.app_code.*'];

function shown(value: unknown): string {
  if (value === null || value === undefined) return '';
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

// 앱 관리 › 데이터 (앱 플랫폼, 스토어 12.4 · 12.5): 앱이 moida.json에 선언한 표의 목록과 줄. 줄 넣기 · 지우기, 내보내기.
// 표와 칸은 앱 코드의 선언으로만 생긴다 (여기서 만들지 않는다). 선언에서 빠진 표는 닫힌 채 줄이 남는다
export function AppDataTab({ app }: { app: AdminApp }) {
  const [picked, setPicked] = useState<string | null>(null);
  const action = useAction();
  const base = `/api/community/admin/${app.id}`;
  const tables = useLiveValue(
    `app-tables:${app.id}`,
    () => api<AppTableList>('GET', `${base}/data`),
    TOPICS,
  );
  const list = tables.data?.tables ?? null;
  const table = list?.find((t) => t.name === picked && t.open) ?? null;

  return (
    <section className="stack" aria-label="데이터">
      {(tables.error || action.problem) && (
        <p className="error">{action.problem ?? tables.error}</p>
      )}
      <div className="row">
        <a className="ghost small" href={`${base}/export`} download>
          데이터 · 회원 내보내기
        </a>
        <a
          className="ghost small"
          href={`/api/apps/${app.id}/code/versions/${app.codeSeq ?? 0}/zip`}
          download
        >
          화면 코드 내보내기
        </a>
      </div>
      {list === null ? (
        !tables.error && <p className="label-mono loading">불러오는 중…</p>
      ) : list.length === 0 ? (
        <p className="rows-empty">표 없음 · 앱 코드의 moida.json에 tables를 선언하면 생겨요</p>
      ) : (
        <ul className="list">
          {list.map((t) => (
            <li key={t.name} className="list-cell">
              <div className="item-main">
                <b>
                  {t.name} {!t.open && <span className="pill">닫힘</span>}
                </b>
                <small>
                  {t.rows.toLocaleString()}줄 · 읽기 {RULES[t.read]} · 쓰기 {RULES[t.write]} ·{' '}
                  {Object.keys(t.columns).join(', ')}
                </small>
              </div>
              {t.open && (
                <button
                  type="button"
                  className="ghost small"
                  aria-pressed={picked === t.name}
                  onClick={() => setPicked(picked === t.name ? null : t.name)}
                >
                  {picked === t.name ? '닫기' : '줄 보기'}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {table && (
        <AppDataRows
          key={table.name}
          base={base}
          table={table}
          busy={action.busy}
          onAdd={(rows) =>
            void action.run('add', () => api('POST', `${base}/data/${table.name}`, { rows }), {
              done: `${rows.length}줄 넣음`,
              reload: tables.reload,
            })
          }
          onRemove={(id) =>
            void action.run(
              `${id}:remove`,
              () => api('DELETE', `${base}/data/${table.name}/${id}`),
              {
                done: '지움',
                reload: tables.reload,
              },
            )
          }
        />
      )}
    </section>
  );
}

/** 표 하나의 줄 (최근 50줄). 표의 줄 수가 바뀌면(넣기 · 지우기) 다시 읽는다 */
function AppDataRows({
  base,
  table,
  busy,
  onAdd,
  onRemove,
}: {
  base: string;
  table: AppTableLine;
  busy: string | null;
  onAdd: (rows: unknown[]) => void;
  onRemove: (id: string) => void;
}) {
  const rows = useLiveValue(
    `app-rows:${base}:${table.name}:${table.rows}`,
    () => api<AppRowPage>('GET', `${base}/data/${table.name}?limit=50`),
    TOPICS,
  );
  const names = Object.keys(table.columns);
  const items = rows.data?.rows ?? null;
  return (
    <div className="panel stack">
      <b>{table.name}</b>
      {rows.error && <p className="error">{rows.error}</p>}
      {items === null ? (
        !rows.error && <p className="label-mono loading">불러오는 중…</p>
      ) : items.length === 0 ? (
        <p className="rows-empty">줄 없음</p>
      ) : (
        <ul className="list">
          {items.map((raw) => {
            const row = raw as Record<string, unknown>;
            const id = String(row.id);
            return (
              <li key={id} className="list-cell">
                <div className="item-main">
                  <small>{names.map((n) => `${n}: ${shown(row[n])}`).join(' · ')}</small>
                  <small className="label-mono">
                    {row.owner ? '회원이 씀' : '관리자가 넣음'} ·{' '}
                    {shown(row.created_at).slice(0, 10)}
                  </small>
                </div>
                <button
                  type="button"
                  className="ghost small"
                  disabled={busy !== null}
                  onClick={() => window.confirm('이 줄을 지울까요?') && onRemove(id)}
                >
                  삭제
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {rows.data?.more && <small>최근 50줄만 보여요 · 전부는 내보내기로</small>}
      <AppDataForm columns={table.columns} busy={busy !== null} onSubmit={onAdd} />
    </div>
  );
}
