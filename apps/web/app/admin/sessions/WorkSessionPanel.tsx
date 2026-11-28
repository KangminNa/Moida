'use client';

import Link from 'next/link';
import { api } from '../../_lib/client-api';
import { useLiveValue } from '../../_lib/use-live';
import type { WorkSession } from '../../_vault/types';

/** 에이전트 실행의 기록인 세션의 도구 이름 (작업 세션, 2026-11-17) */
export const WORK_TOOL = 'cairn-agent';

/** 요청의 열쇠(chat:<대화> · goal-run:<실행> · task:<작업>) → 콘솔 주소와 이름 */
function requestLink(flow: string): [string, string] | null {
  const [kind, id] = flow.split(':');
  if (!id) return null;
  if (kind === 'chat') return [`/admin/chats/${id}`, '대화 열기'];
  if (kind === 'goal-run') return [`/admin/goals/runs/${id}`, '목표 실행 열기'];
  return kind === 'task' ? [`/admin/tasks/${id}`, '작업 열기'] : null;
}

/** 정리 상태 (S2): 끝난 요청까지의 버전만 wiki로 정리한다. 진행 중 · 취소 · 반려된 요청의 버전은 원문으로만 */
function tidyLine(w: WorkSession): string {
  if (w.settledSeq === 0) return '요청이 끝나면 wiki로 정리해요';
  const done =
    w.tidyRequestedSeq >= w.settledSeq
      ? `버전 ${w.settledSeq}까지 정리 요청함`
      : `버전 ${w.settledSeq}까지 정리 대기`;
  return w.settledSeq < w.revisionCount ? `${done} · 그 뒤는 요청이 끝나면` : done;
}

// 작업 세션 (S2): 어느 요청의 기록인지, 정리 상태, 실행마다 남긴 인수인계 메모 (새것부터)
// topics · when은 세션 화면(SessionPanel)의 것을 받는다 (두 파일이 서로 가져오지 않게)
export function WorkSessionPanel({
  id,
  topics,
  when,
}: {
  id: string;
  topics: readonly string[];
  when: (iso: string | null) => string;
}) {
  const work = useLiveValue(
    `session-work:${id}`,
    () => api<WorkSession>('GET', `/api/sessions/${id}/work`),
    topics,
  );
  if (work.error) return <p className="error">{work.error}</p>;
  const w = work.data;
  if (!w) return <p className="label-mono loading">불러오는 중…</p>;
  const link = w.flow ? requestLink(w.flow) : null;
  return (
    <section className="result" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <b>작업 세션</b>
        {link && (
          <Link className="ghost" href={link[0]}>
            {link[1]}
          </Link>
        )}
      </div>
      <p className="label-mono" style={{ margin: 0 }}>
        {tidyLine(w)}
      </p>
      {w.memos.length === 0 ? (
        <p className="label-mono" style={{ margin: 0 }}>
          인수인계 메모 없음
        </p>
      ) : (
        w.memos.map((m) => (
          <section key={m.id} className="note-section">
            <h4>
              {[
                m.agent,
                m.taskTitle,
                `${m.runSeq}번째 실행`,
                m.writtenBy === 'runner' ? '러너가 씀' : null,
                when(m.at),
              ]
                .filter(Boolean)
                .join(' · ')}
            </h4>
            <p style={{ whiteSpace: 'pre-wrap' }}>{m.memo}</p>
          </section>
        ))
      )}
    </section>
  );
}
