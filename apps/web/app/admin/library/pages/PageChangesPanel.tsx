'use client';

import type { PageChanges } from '../../../_blog/types';
import { api } from '../../../_lib/client-api';
import { useLiveValue } from '../../../_lib/use-live';

const KIND: Readonly<Record<string, string>> = { added: '추가', changed: '바뀜', removed: '빠짐' };

// 버전 하나의 바뀐 점: 앞 버전과 비교한 data.json의 차이 (자라는 페이지). 버전은 바뀌지 않아 변경 신호를 듣지 않는다.
export function PageChangesPanel({ id, seq }: { id: string; seq: number }) {
  const read = useLiveValue(
    `page-changes:${id}:${seq}`,
    () => api<PageChanges>('GET', `/api/pages/${id}/revisions/${seq}/changes`),
    [],
  );
  const c = read.data;
  if (!c)
    return read.error ? (
      <p className="error">{read.error}</p>
    ) : (
      <p className="label-mono loading">불러오는 중…</p>
    );
  if (!c.data) return <small>data.json 없음</small>;
  if (c.changes.length === 0) return <small>버전 {c.base}와 같은 데이터</small>;
  return (
    <ul className="page-changes" aria-label={`버전 ${seq}의 바뀐 점`}>
      {c.changes.map((x) => (
        <li key={`${x.kind}:${x.path}`}>
          <span className="pill">{KIND[x.kind] ?? x.kind}</span> <code>{x.path}</code>
          {x.before !== null && <del>{x.before}</del>}
          {x.after !== null && <ins>{x.after}</ins>}
        </li>
      ))}
      {c.truncated && (
        <li>
          <small>처음 100개만</small>
        </li>
      )}
    </ul>
  );
}
