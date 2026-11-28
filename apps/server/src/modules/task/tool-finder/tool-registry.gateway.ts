import { ExternalFailure } from '../../platform';
import { PublicHttpsGateway } from '../web/public-https.gateway';

// 공식 MCP 레지스트리 검색 (2026-11-24, find_tool). 서버가 정해진 주소 하나(REGISTRY)에만 GET한다: 일꾼이 주소를 고르지 못한다.
// 바깥에 붙는 규칙은 PublicHttpsGateway. 답은 믿지 않는 자료라 ToolFinder가 칸을 골라 거른다.
// 시험에서만 MOIDA_TOOL_REGISTRY_URL로 루프백의 가짜 레지스트리를 쓴다 (TEST_LOOPBACK_ENV와 함께)
export class ToolRegistryGateway extends PublicHttpsGateway {
  static readonly REGISTRY = 'https://registry.modelcontextprotocol.io';
  static readonly TEST_URL_ENV = 'MOIDA_TOOL_REGISTRY_URL';
  static readonly MAX_BYTES = 1024 * 1024;
  static readonly LIMIT = 30;
  protected readonly name = 'MCP 레지스트리';
  protected readonly agent = 'Moida/1.0 (tool finder)';
  protected override readonly timeoutMs = 10_000;

  /** 이름에 글자가 든 서버들의 최신 버전 (레지스트리의 답 그대로) */
  async search(query: string): Promise<unknown> {
    const url = new URL('/v0.1/servers', ToolRegistryGateway.base());
    url.searchParams.set('search', query);
    url.searchParams.set('limit', String(ToolRegistryGateway.LIMIT));
    url.searchParams.set('version', 'latest');
    const target = await this.pin(url);
    const answer = await this.call(async (signal) => {
      const res = await this.open(target, 'GET', { accept: 'application/json' }, null, signal);
      const text = (await PublicHttpsGateway.readAll(res, ToolRegistryGateway.MAX_BYTES)).toString(
        'utf8',
      );
      return { status: res.statusCode ?? 0, body: PublicHttpsGateway.json(text) };
    });
    if (answer.status !== 200 || answer.body === null)
      throw new ExternalFailure(`MCP 레지스트리가 ${answer.status}로 답했어요`);
    return answer.body;
  }

  private static base(): string {
    const test = process.env[ToolRegistryGateway.TEST_URL_ENV];
    return test && PublicHttpsGateway.loopback() ? test : ToolRegistryGateway.REGISTRY;
  }
}
