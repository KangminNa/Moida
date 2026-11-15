import { BaseRequest } from '../base/base-request';

/** 다시 시도할 멈춘 이벤트 (POST /api/events/:id/retry). id는 outbox 줄 번호 */
export class FailedEventInput extends BaseRequest {
  private static readonly ID = /^[1-9]\d{0,17}$/;

  private constructor(readonly id: number) {
    super();
  }

  static from(params: unknown): FailedEventInput {
    return BaseRequest.read(params, (f) => {
      const id = f.text('id', 18);
      if (!FailedEventInput.ID.test(id)) f.reject('id', '1 이상의 정수예요');
      return new FailedEventInput(Number(id));
    });
  }
}
