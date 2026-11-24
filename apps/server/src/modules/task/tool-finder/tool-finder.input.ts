import { BaseRequest } from '../../platform';

/** MCP find_tool: 찾을 서비스 이름과 (있으면) 그 서비스의 도메인 */
export class FindToolInput extends BaseRequest {
  private constructor(
    readonly query: string,
    readonly domain: string | null,
  ) {
    super();
  }

  static from(raw: unknown): FindToolInput {
    return BaseRequest.read(
      raw,
      (f) => new FindToolInput(f.text('query', 60), f.optionalText('domain', 200)),
    );
  }
}
