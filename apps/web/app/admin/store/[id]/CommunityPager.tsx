'use client';

// 관리 목록의 쪽 넘김 (최근부터 30개씩, 서버가 준 nextCursor). 처음으로 돌아가기만 둔다 (앞 쪽 되짚기 없음)
export function CommunityPager({
  cursor,
  next,
  onMove,
}: {
  cursor: string | null;
  next: string | null;
  onMove: (cursor: string | null) => void;
}) {
  if (cursor === null && next === null) return null;
  return (
    <div className="row">
      {cursor !== null && (
        <button type="button" className="ghost small" onClick={() => onMove(null)}>
          처음으로
        </button>
      )}
      {next !== null && (
        <button type="button" className="ghost small" onClick={() => onMove(next)}>
          다음 쪽
        </button>
      )}
    </div>
  );
}
