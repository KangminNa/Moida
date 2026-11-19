'use client';

import { NewTabLink } from '../../_ui/NewTabLink';

/** 사진 하나 (결과물 id · 이름), at은 참조 목록 안의 자리 (빼기) */
type PhotoItem = { id: string; title: string; at: number };

// 사진 미리보기 (입력 칸 · 보낸 메시지): 결과물의 그림을 바로 그리고(inline), 누르면 새 탭에서 크게 본다.
// onRemove가 있으면 빼기 단추 (입력 칸). waiting은 올리는 중인 장수 (자리만 그린다)
export function PhotoThumbs({
  photos,
  waiting = 0,
  onRemove,
}: {
  photos: readonly PhotoItem[];
  waiting?: number;
  onRemove?: (at: number) => void;
}) {
  if (photos.length === 0 && waiting === 0) return null;
  return (
    <ul className="photo-thumbs" aria-label="사진">
      {photos.map((p) => (
        <li key={p.id}>
          <NewTabLink href={`/api/outputs/${p.id}/file?view=1`}>
            <img src={`/api/outputs/${p.id}/file?inline=1`} alt={p.title} />
          </NewTabLink>
          {onRemove && (
            <button
              type="button"
              className="photo-remove"
              aria-label={`${p.title} 빼기`}
              onClick={() => onRemove(p.at)}
            >
              ×
            </button>
          )}
        </li>
      ))}
      {Array.from({ length: waiting }, (_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: 올리는 중인 자리는 순서만 있다
        <li key={`waiting-${i}`} className="photo-waiting" aria-label="사진 올리는 중" />
      ))}
    </ul>
  );
}
