import { Injectable } from '@nestjs/common';
import { Actor, BaseQuery, Database } from '../../platform';
import type { FindToolInput } from './tool-finder.input';
import { ToolFinder } from './tool-finder.policy';
import { FoundToolsView } from './tool-finder.view';
import { ToolRegistryGateway } from './tool-registry.gateway';

// 도구 찾기 (MCP find_tool, 작업 토큰, 2026-11-24): 공식 MCP 레지스트리를 서버가 대신 찾고, 공식 · 제3자 · 로컬 실행용을 가른다.
// 붙이지는 않는다: 일꾼이 후보로 propose_tool(원격 MCP) · propose_api(API 정의서)를 내고 관리자가 승인한다.
// 바깥 호출을 기다리는 동안 트랜잭션을 열지 않는다 (DB를 쓰지 않는다)
@Injectable()
export class ToolFinderQuery extends BaseQuery {
  constructor(
    db: Database,
    private readonly registry: ToolRegistryGateway,
  ) {
    super(db);
  }

  async find(actor: Actor, req: FindToolInput): Promise<FoundToolsView> {
    actor.assertCan(Actor.AGENT);
    const domain = ToolFinder.domainOf(req.domain);
    const body = await this.registry.search(req.query);
    return new FoundToolsView(req.query, domain, ToolFinder.candidates(body, domain));
  }
}
