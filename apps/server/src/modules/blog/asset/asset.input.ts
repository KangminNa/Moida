import { BaseRequest, UnsupportedType } from '../../platform';
import { AppScreenInput } from '../app-code/app-code.input';
import { ImagePolicy } from './image.policy';

/** POST /api/posts/:id/assets. 본문이 파일 그대로다. 형식은 머리글이 아니라 파일의 앞부분으로 정한다 */
export class UploadAssetInput extends BaseRequest {
  private constructor(
    readonly postId: string,
    readonly bytes: Buffer,
    readonly mime: string,
  ) {
    super();
  }

  static from(id: string, body: unknown): UploadAssetInput {
    const postId = BaseRequest.read({ id }, (f) => f.uuid('id'));
    // 이미지 머리글이 아니면 본문을 읽지 않아서 Buffer가 아니다
    const mime = Buffer.isBuffer(body) ? ImagePolicy.mimeOf(body) : null;
    if (!mime) throw new UnsupportedType('PNG · JPEG · WebP · GIF 사진만 올릴 수 있어요');
    return new UploadAssetInput(postId, body as Buffer, mime);
  }
}

/**
 * GET /api/files/:hash?ticket=: 사진 하나. ticket은 앱 코드 미리 보기 토큰 (스토어 1-6b):
 * 격리된 미리 보기 화면에는 쿠키가 실리지 않아 비공개 앱 글의 사진을 토큰으로 연다
 */
export class ReadFileInput extends BaseRequest {
  private constructor(
    readonly hash: string,
    readonly ticket: string | null,
  ) {
    super();
  }

  static from(hash: string, query: unknown): ReadFileInput {
    const ticket = (query as { ticket?: unknown } | null)?.ticket ?? null;
    return BaseRequest.read(
      { hash, ticket },
      (f) =>
        new ReadFileInput(
          f.text('hash', 200),
          AppScreenInput.ticketOf(f.optionalText('ticket', 2000)),
        ),
    );
  }
}
