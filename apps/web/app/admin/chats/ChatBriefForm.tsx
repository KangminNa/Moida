'use client';

import { useState } from 'react';
import type { ChatTurn } from '../../_task/types';

type Brief = NonNullable<ChatTurn['brief']>;

/** 답들을 다음 회차의 메시지로 (관리자의 말이라 대표가 그대로 완료 조건의 위에 둔다) */
export function briefMessage(brief: Brief, answers: readonly string[]): string {
  const lines = brief.questions.map(
    (q, i) => `${i + 1}. ${q.text} → ${answers[i]?.trim() || q.suggested}`,
  );
  return [
    `목표 확인 답 (${brief.summary})`,
    ...lines,
    '이 답을 기준으로 계획을 세워 진행해 주세요.',
  ].join('\n');
}

// 목표 확인 질문 카드 (2026-11-20): 대표가 결과물 일을 맡기 전에 물은 것. 칸마다 대표의 추천 답이 미리 채워져 있고
// 고를 답(칩)을 누르거나 직접 고친다. "추천대로 진행"은 고치지 않은 그대로 보낸다. 보내면 다음 회차의 메시지가 된다.
// 답 칸은 이 폼의 상태다. 보내기는 패널이 한다 (보낸 뒤 회차가 늘면 이 카드는 사라진다)
export function ChatBriefForm({
  brief,
  busy,
  onAnswer,
}: {
  brief: Brief;
  busy: boolean;
  onAnswer: (message: string) => void;
}) {
  const [answers, setAnswers] = useState<string[]>(() => brief.questions.map((q) => q.suggested));
  const set = (i: number, value: string) =>
    setAnswers((before) => before.map((a, k) => (k === i ? value : a)));
  const changed = answers.some((a, i) => a !== brief.questions[i]?.suggested);

  return (
    <section className="panel result-card brief-card" aria-label="목표 확인">
      <header>
        <h2 className="sec-title flat">목표 확인</h2>
        <small>{brief.summary}</small>
      </header>
      <ol className="brief-list">
        {brief.questions.map((q, i) => (
          <li key={q.text} className="field">
            <label htmlFor={`brief-${i}`}>
              <b>{q.text}</b>
              {q.why && <small>{q.why}</small>}
            </label>
            {q.choices.length > 0 && (
              <div className="row brief-choices">
                {q.choices.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className="chip"
                    aria-pressed={answers[i] === c}
                    onClick={() => set(i, c)}
                  >
                    {c}
                  </button>
                ))}
              </div>
            )}
            <input
              id={`brief-${i}`}
              className="input"
              maxLength={300}
              value={answers[i] ?? ''}
              placeholder={q.suggested}
              onChange={(e) => set(i, e.target.value)}
            />
          </li>
        ))}
      </ol>
      <div className="row result-actions">
        <button
          type="button"
          className="cta small"
          disabled={busy}
          onClick={() => onAnswer(briefMessage(brief, answers))}
        >
          {changed ? '이 답으로 진행' : '추천대로 진행'}
        </button>
      </div>
    </section>
  );
}
