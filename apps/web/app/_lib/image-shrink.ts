// 사진을 올리기 전에 브라우저에서 줄인다 (2026-11-27, 사용자 "사진 관련해서 부담을 줄일 순 없나" · 1번 안).
//   긴 변을 정한 크기 이하로 맞추고 WebP로 다시 그린다 (브라우저가 WebP로 못 그리면 JPEG · PNG).
//   다시 그리면 사진 안의 위치(GPS) · 기기 정보(EXIF)가 빠진다: 폰 사진을 그대로 올려 찍은 곳이 드러나지 않게.
//   움직이는 GIF와 사진이 아닌 파일은 그대로 둔다. 읽지 못하는 사진도 그대로 보낸다 (형식은 서버가 앞부분으로 다시 본다).
//   줄인 것이 원본보다 크면(이미 작은 사진) 원본을 보낸다. 단 JPEG은 위치 정보 때문에 늘 다시 그린 것을 보낸다

/** 줄일 형식 (GIF는 움직임이 사라져서 빼고, SVG는 서버가 받지 않는다) */
const SHRINKABLE = ['image/jpeg', 'image/png', 'image/webp'];
/** WebP · JPEG의 품질 (0~1) */
const QUALITY = 0.85;

/** 쓰임마다 긴 변의 최대 (px) */
export const SHRINK = {
  /** 글 · 대화의 사진: 화면 너비 두 배 정도면 레티나에서도 선명하다 */
  photo: 2048,
  /** 로고 · 앱 아이콘: 작게 보인다 */
  icon: 512,
} as const;

/** 긴 변을 max 이하로 맞춘 크기 (비율 그대로, 키우지 않는다) */
export function fitSize(
  width: number,
  height: number,
  max: number,
): { width: number; height: number } {
  const long = Math.max(width, height);
  if (long <= max || long === 0) return { width, height };
  const scale = max / long;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** 새 형식에 맞춘 파일 이름 (확장자만 바꾼다) */
export function shrunkName(name: string, type: string): string {
  const ext = type === 'image/webp' ? 'webp' : type === 'image/jpeg' ? 'jpg' : 'png';
  const base = name.replace(/\.[^./\\]+$/, '') || 'photo';
  return `${base}.${ext}`;
}

/** 줄일 수 있는 사진인가 (형식으로만, 내용은 그릴 때 본다) */
export function shrinkable(type: string): boolean {
  return SHRINKABLE.includes(type);
}

/** 사진이면 줄인 새 파일, 아니면(또는 줄이지 못하면) 받은 파일 그대로 */
export async function shrinkImage(file: File, max: number): Promise<File> {
  if (!shrinkable(file.type) || typeof createImageBitmap !== 'function') return file;
  let bitmap: ImageBitmap;
  try {
    // 폰 사진의 회전(EXIF orientation)을 따라 그린다
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    return file;
  }
  try {
    const size = fitSize(bitmap.width, bitmap.height, max);
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext('2d');
    if (!context) return file;
    context.imageSmoothingQuality = 'high';
    context.drawImage(bitmap, 0, 0, size.width, size.height);
    const blob = await encode(canvas, file.type);
    if (!blob) return file;
    if (blob.size >= file.size && file.type !== 'image/jpeg') return file;
    return new File([blob], shrunkName(file.name, blob.type), {
      type: blob.type,
      lastModified: file.lastModified,
    });
  } finally {
    bitmap.close();
  }
}

/** WebP로, 못 하면(옛 Safari는 PNG를 준다) 원본이 JPEG이면 JPEG, 아니면 PNG (투명을 지킨다) */
async function encode(canvas: HTMLCanvasElement, original: string): Promise<Blob | null> {
  const as = (type: string) =>
    new Promise<Blob | null>((done) => canvas.toBlob(done, type, QUALITY));
  const webp = await as('image/webp');
  if (webp?.type === 'image/webp') return webp;
  return as(original === 'image/jpeg' ? 'image/jpeg' : 'image/png');
}
