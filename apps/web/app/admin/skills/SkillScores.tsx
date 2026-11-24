import type { SkillDetail } from '../../_task/types';

type Score = SkillDetail['scores'][number];

const percent = (part: number, whole: number) =>
  whole > 0 ? `${Math.round((part / whole) * 100)}%` : '-';

const versionOf = (s: Score) =>
  s.source === 'console' ? `콘솔 버전 ${s.revision}` : `저장소 버전 ${(s.hash ?? '').slice(0, 7)}`;

// 스킬 버전 성적표 (2026-11-24): 버전마다 최근 기간에 처음 실행한 일의 끝냄 · 한 번에 통과 · 고쳐 달라 · 토큰.
// 끝난 일이 적은 버전은 비율을 보이지 않고 "판단 보류"로 둔다 (몇 개로 버전을 고르지 않게)
export function SkillScores({
  scores,
  days,
  min,
}: {
  scores: readonly Score[];
  days: number;
  min: number;
}) {
  return (
    <>
      <h2 className="label-mono">버전별 성적 · 최근 {days}일</h2>
      {scores.length === 0 ? (
        <p className="note">아직 이 스킬로 한 일 없음</p>
      ) : (
        <ol className="list">
          {scores.map((s) => {
            const finished = s.done + s.failed;
            return (
              <li key={`${s.source}:${s.revision}:${s.hash}`} className="list-cell stack">
                <b>{versionOf(s)}</b>
                <span className="label-mono">
                  일 {s.tasks}개 · 끝냄 {s.done} · 실패 {s.failed}
                </span>
                {s.settled ? (
                  <span>
                    한 번에 통과 {percent(s.firstPass, finished)} · 고쳐 달라 평균 {s.avgFixes ?? 0}
                    번 · 실행 평균 {s.avgRuns ?? 0}번
                    {s.tokensPerDone !== null &&
                      ` · 끝낸 일당 ${s.tokensPerDone.toLocaleString('ko-KR')} 토큰`}
                  </span>
                ) : (
                  <span className="note">
                    판단 보류 · 끝난 일 {finished}개 ({min}개부터 비율)
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </>
  );
}
