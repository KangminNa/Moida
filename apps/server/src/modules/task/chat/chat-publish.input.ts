import { BaseRequest } from '../../platform';
import { OwnerAsk } from './owner-ask.policy';

/** MCP publish_app { app_id, quote } (2026-11-24, 작업 토큰): 관리자가 대화에서 앱의 배포 · 수정을 요청한 말을 대표가 그대로 인용한다 */
export class PublishAppInput extends BaseRequest {
  private constructor(
    readonly appId: string,
    readonly quote: string,
  ) {
    super();
  }

  static from(raw: unknown): PublishAppInput {
    return BaseRequest.read(
      raw,
      (f) => new PublishAppInput(f.uuid('app_id'), f.text('quote', OwnerAsk.QUOTE_MAX)),
    );
  }
}
