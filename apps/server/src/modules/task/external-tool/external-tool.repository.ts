import { Database, type DomainEvent, Outbox, RuleViolation, TableRepository } from '../../platform';
import { externalTools } from '../task.schema';
import type { ExternalToolRow } from '../task.tables';
import { ExternalTool } from './external-tool';

// task.external_tools ↔ ExternalTool. 불러오기 · 잠그기 · 저장(바뀐 칸만, version으로 늦은 쓰기를 막는다)은 기반이 한다.
export class ExternalToolRepository extends TableRepository<ExternalToolRow, ExternalTool> {
  protected readonly table = externalTools;
  protected readonly noun = '외부 도구';

  protected toEntity(row: ExternalToolRow): ExternalTool {
    return ExternalTool.restore(row);
  }

  /** 같은 이름은 공간에 하나 (러너 안의 MCP 서버 이름이다) */
  override async save(tool: ExternalTool): Promise<void> {
    try {
      await super.save(tool);
    } catch (error) {
      if (Database.isUniqueViolation(error, 'external_tools_space_id_name_key'))
        throw new RuleViolation('이미 쓰는 이름이에요');
      throw error;
    }
  }

  /** 이 이름들 가운데 공간에 없는 것 (에이전트의 허락 목록을 저장하기 전에, AgentEdit) */
  async missing(spaceId: string, names: readonly string[]): Promise<string[]> {
    const rows = await this.sql<Pick<ExternalToolRow, 'name'>[]>`
      SELECT name FROM task.external_tools WHERE space_id = ${spaceId} AND name = ANY(${[...names]}::text[])`;
    const found = new Set(rows.map((r) => r.name));
    return names.filter((n) => !found.has(n));
  }

  /** 서버 키를 바꾼 뒤 다시 잠글 것 (토큰이 있는 도구 전부) */
  async lockSealed(): Promise<readonly ExternalTool[]> {
    const rows = await this.sql<ExternalToolRow[]>`
      SELECT * FROM task.external_tools WHERE secret IS NOT NULL ORDER BY id FOR UPDATE`;
    return rows.map((r) => this.toEntity(r));
  }

  /** 도구 저장과 따로 내는 이벤트 (결재 결과: 도구가 없거나 바뀌지 않았어도 알려야 작업이 끝난다) */
  async announce(event: DomainEvent): Promise<void> {
    await new Outbox(this.sql).publish([event]);
  }

  /** 지운다 (설정이라 판을 남기지 않는다). 허락한 에이전트에서 떼는 일은 Service가 같은 트랜잭션에서 */
  async remove(tool: ExternalTool): Promise<void> {
    await this.deleteRows(externalTools, { space_id: tool.spaceId, id: tool.id });
  }
}
