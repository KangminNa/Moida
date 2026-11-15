import { useEffect, useState } from 'react';
import type { Call, IntegrationDetail } from './browser-types';

// 사이트 도구 하나의 자세히: 최근 버전의 시험 결과 · 입출력 형식 · 코드, 최근 실행. 승인 전에 코드를 읽어 보는 자리다

const RUN: Record<string, string> = {
  queued: '기다림',
  running: '도는 중',
  done: '끝남',
  failed: '실패',
};

const when = (iso: string) =>
  new Date(iso).toLocaleString('ko-KR', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

export function IntegrationDetailPanel({ call, id }: { call: Call; id: string }) {
  const [detail, setDetail] = useState<IntegrationDetail | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    call('GET', `integrations/${id}`).then((reply) => {
      if (!live) return;
      if (reply.ok) setDetail(reply.data as IntegrationDetail);
      else setProblem(reply.message);
    });
    return () => {
      live = false;
    };
  }, [call, id]);

  if (problem) return <p className="error">{problem}</p>;
  if (!detail) return <p className="note">불러오는 중</p>;
  const [latest] = detail.revisions;
  return (
    <div className="stack">
      {latest ? (
        <>
          <b>
            버전 {latest.seq} · 시험 {latest.passed}/{latest.total} 통과
          </b>
          <ul className="list" aria-label="시험">
            {latest.tests.map((t) => (
              <li key={t.name} className="row">
                <span className="pill">{t.ok ? '통과' : '실패'}</span>
                <span>{t.name}</span>
                {t.problem && <span className="note">{t.problem}</span>}
              </li>
            ))}
          </ul>
          <details>
            <summary>입출력 형식</summary>
            <pre className="raw">
              {JSON.stringify({ input: latest.inputSchema, output: latest.outputSchema }, null, 2)}
            </pre>
          </details>
          <details open>
            <summary>코드</summary>
            <pre className="raw">{latest.code}</pre>
          </details>
        </>
      ) : (
        <p className="note">아직 굳힌 버전이 없어요</p>
      )}
      <b>최근 실행</b>
      {detail.runs.length === 0 ? (
        <p className="note">아직 실행 없음</p>
      ) : (
        <ul className="list" aria-label="최근 실행">
          {detail.runs.map((r) => (
            <li key={r.id} className="stack">
              <span className="label-mono">
                {when(r.createdAt)} · 버전 {r.seq} · {RUN[r.status] ?? r.status}
                {r.ms !== null ? ` · ${(r.ms / 1000).toFixed(1)}초` : ''}
              </span>
              {r.input && <span className="mono">입력 {r.input}</span>}
              {r.output && <span className="mono">답 {r.output}</span>}
              {r.error && (
                <span className="note">
                  {r.errorKind ? `${r.errorKind} · ` : ''}
                  {r.error}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
