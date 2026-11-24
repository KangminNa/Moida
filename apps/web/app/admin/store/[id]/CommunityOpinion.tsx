'use client';

import { api } from '../../../_lib/client-api';
import { useAction } from '../../../_lib/use-action';
import { ChangeLines } from '../../../_task/ChangeLines';
import { usePendingApprovals } from '../../../_task/live';
import type { Approval } from '../../../_task/types';

/** 신고 검토의 설정 바꾸기 (서버 ModerationChange.SETTING.setting) */
const MODERATION = 'moderation';

// 신고 줄의 AI 의견 (2026-11-24, 스토어 3-3): 일꾼이 그 글 · 댓글이나 쓴 회원에게 올린 결정 제안(기다리는 승인)을 보이고
// 여기서 바로 승인 · 반려한다. 승인하면 서버가 관리자 결정과 같은 줄로 반영한다 (기록은 "승인한 AI 제안").
// 의견이 없으면 아무것도 그리지 않는다: 검토 일이 아직 돌고 있거나, 일꾼이 없거나, 이미 정했다
export function CommunityOpinion({
  targetIds,
  reload,
}: {
  /** 이 신고의 대상(글 · 댓글)과 쓴 회원 */
  targetIds: readonly string[];
  reload: () => Promise<void>;
}) {
  const pending = usePendingApprovals();
  const action = useAction();
  const found = (pending.data?.approvals ?? []).filter(
    (a) => a.setting === MODERATION && targetIds.includes(a.target.id),
  );
  if (found.length === 0) return null;

  const decide = (a: Approval, decision: 'approve' | 'reject') =>
    action.run(
      `opinion:${a.id}:${decision}`,
      () =>
        api<Approval>('POST', `/api/approvals/${a.id}/decide`, { version: a.version, decision }),
      {
        done: decision === 'approve' ? 'AI 의견대로 반영' : 'AI 의견 반려',
        reload: async () => {
          await Promise.all([pending.reload(), reload()]);
        },
      },
    );

  return (
    <div className="stack">
      {action.problem && <p className="error">{action.problem}</p>}
      {found.map((a) => (
        <section key={a.id} className="panel stack" aria-label="AI 의견">
          <b>AI 의견</b>
          <ChangeLines lines={a.changes ?? []} setting={a.setting} />
          {a.note && <small>{a.note}</small>}
          <div className="row">
            <button
              type="button"
              className="cta small"
              disabled={action.busy !== null}
              onClick={() => decide(a, 'approve')}
            >
              승인
            </button>
            <button
              type="button"
              className="ghost"
              disabled={action.busy !== null}
              onClick={() => decide(a, 'reject')}
            >
              반려
            </button>
          </div>
        </section>
      ))}
    </div>
  );
}
