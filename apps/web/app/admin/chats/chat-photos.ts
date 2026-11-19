// 대화에 넣는 사진의 규칙 (대화에 사진 넣기 ②-c): 형식 · 크기 · 장수. 입력 칸(ChatForm)과 올린 결과물을 참조로 붙이는 패널이 함께 쓴다

/** 사진으로 넣는 형식 (서버 OutputPolicy.PHOTO_MIMES: 앞부분으로 알아본 그림) */
export const PHOTO_TYPES: readonly string[] = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
];
/** 사진 한 장의 한도 (러너 JobPhotos.MAX_BYTES와 같다: 넘으면 AI가 받지 못한다) */
const PHOTO_MAX_BYTES = 10 * 1024 * 1024;
/** 한 메시지의 사진 (서버 TaskRefs.PHOTOS_MAX) */
const PHOTOS_MAX = 4;

/**
 * 넣을 사진을 고른다 (대화에 사진 넣기 ②-c): 형식 · 크기를 보고, 이미 넣은 사진(already)과 합쳐 4장까지.
 * 빠진 것이 있으면 그 까닭 하나 (서버도 같은 규칙으로 막는다: 4장 넘으면 422)
 */
export function pickPhotos(
  files: readonly File[],
  already: number,
): { photos: File[]; problem: string | null } {
  const typed = files.filter((f) => PHOTO_TYPES.includes(f.type));
  const sized = typed.filter((f) => f.size <= PHOTO_MAX_BYTES);
  const photos = sized.slice(0, Math.max(0, PHOTOS_MAX - already));
  const problem =
    typed.length < files.length
      ? 'PNG · JPEG · WebP · GIF 사진만 넣어요'
      : sized.length < typed.length
        ? '10MB가 넘는 사진은 넣지 못해요'
        : photos.length < sized.length
          ? `사진은 한 번에 ${PHOTOS_MAX}장까지예요`
          : null;
  return { photos, problem };
}
