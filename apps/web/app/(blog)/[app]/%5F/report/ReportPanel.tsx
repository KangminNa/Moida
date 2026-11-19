'use client';

import { useState } from 'react';
import { REPORT_REASON_LABELS } from '../../../../_community/labels';
import { memberApi } from '../../../../_community/member-api';
import { useAction } from '../../../../_lib/use-action';

type Reason = keyof typeof REPORT_REASON_LABELS;

// 신고: 까닭 하나 + 메모(500자까지). 누가 신고했는지는 운영자에게만 보인다
export function ReportPanel({
  csrf,
  topicId,
  commentId,
  target,
  notice,
}: {
  csrf: string | null;
  topicId: string;
  commentId: string | null;
  target: string;
  notice: string | null;
}) {
  const [reason, setReason] = useState<Reason | null>(null);
  const [note, setNote] = useState('');
  const [sent, setSent] = useState(false);
  const action = useAction();
  const back = `/t/${topicId}`;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const reply = await action.run('report', () =>
      memberApi(csrf, 'POST', 'reports', {
        ...(commentId ? { commentId } : { topicId }),
        reason,
        note: note.trim() || null,
      }),
    );
    if (reply?.ok) setSent(true);
  }

  if (sent)
    return (
      <div className="member-form">
        <p className="note">신고를 받았어요. 운영자가 확인해요</p>
        <a className="ghost" href={back}>
          돌아가기
        </a>
      </div>
    );

  return (
    <form className="member-form" onSubmit={submit}>
      <blockquote className="member-target">{target.slice(0, 200)}</blockquote>
      {notice && <p className="note">{notice}</p>}
      <fieldset className="member-reasons">
        <legend>까닭</legend>
        {(Object.keys(REPORT_REASON_LABELS) as Reason[]).map((key) => (
          <label key={key} className="member-check">
            <input
              type="radio"
              name="reason"
              checked={reason === key}
              onChange={() => setReason(key)}
            />
            <span>{REPORT_REASON_LABELS[key]}</span>
          </label>
        ))}
      </fieldset>
      <label className="field">
        <span>메모 (선택)</span>
        <textarea
          className="input"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          maxLength={500}
        />
      </label>
      {action.problem && <p className="error">{action.problem}</p>}
      <div className="member-actions">
        <button
          className="cta"
          type="submit"
          disabled={action.busy !== null || !!notice || reason === null}
        >
          {action.busy ? '보내는 중' : '신고'}
        </button>
        <a className="ghost" href={back}>
          취소
        </a>
      </div>
    </form>
  );
}
