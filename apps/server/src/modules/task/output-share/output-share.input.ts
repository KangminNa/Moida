import { BaseRequest } from '../../platform';
import { OutputShare } from './output-share';

// 결과물 공유 링크 입력의 모양. 기간이 고를 수 있는 값인지는 OutputShare.open이 본다 (422)

/** POST /api/output-shares { requestId, outputId, days }. 같은 requestId는 처음 만든 링크 */
export class CreateOutputShareInput extends BaseRequest {
  private constructor(
    readonly requestId: string,
    readonly outputId: string,
    readonly days: number,
  ) {
    super();
  }

  static from(raw: unknown): CreateOutputShareInput {
    const longest = Math.max(...OutputShare.DAYS);
    return BaseRequest.read(
      raw,
      (f) =>
        new CreateOutputShareInput(
          f.uuid('requestId'),
          f.uuid('outputId'),
          f.integer('days', 1, longest),
        ),
    );
  }
}

/** GET /api/output-shares?outputId= (없으면 공간의 살아 있는 링크 전부) */
export class ListOutputSharesInput extends BaseRequest {
  private constructor(readonly outputId: string | null) {
    super();
  }

  static from(raw: unknown): ListOutputSharesInput {
    const query = (raw ?? {}) as Record<string, unknown>;
    return BaseRequest.read(
      query,
      (f) => new ListOutputSharesInput(query.outputId === undefined ? null : f.uuid('outputId')),
    );
  }
}

/** POST /api/output-shares/:id/end */
export class EndOutputShareInput extends BaseRequest {
  private constructor(readonly id: string) {
    super();
  }

  static from(id: string): EndOutputShareInput {
    return BaseRequest.read({ id }, (f) => new EndOutputShareInput(f.uuid('id')));
  }
}

/** GET /api/output-shares/open/:token (웹의 /share/<토큰>) */
export class OpenOutputShareInput extends BaseRequest {
  /** "<uuid>.<base64url HMAC>"보다 넉넉히 */
  private static readonly MAX = 120;

  private constructor(readonly token: string) {
    super();
  }

  static from(token: string): OpenOutputShareInput {
    return BaseRequest.read(
      { token },
      (f) => new OpenOutputShareInput(f.text('token', OpenOutputShareInput.MAX)),
    );
  }
}
