import { Database, type DomainEvent, Outbox, RuleViolation, TableRepository } from '../../platform';
import { externalTools } from '../task.schema';
import type { ExternalToolRow } from '../task.tables';
import { ExternalTool } from './external-tool';
import type { ToolCalls, ToolLine } from './tool-catalog.policy';

// task.external_tools ↔ ExternalTool. 불러오기 · 잠그기 · 저장(바뀐 칸만, version으로 늦은 쓰기를 막는다)은 기반이 한다.
export class ExternalToolRepository extends TableRepository<ExternalToolRow, ExternalTool> {
  protected readonly table = externalTools;
  protected readonly noun = '외부 도구';
  /** 켜진 도구를 다시 확인하는 간격 */
  private static readonly RECHECK_MS = 24 * 60 * 60 * 1000;

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

  /**
   * 연결 확인의 결과 (tool_check가 끝나면, 2026-11-15 MCP 1단계). 실패면 앞 목록을 그대로 두고 까닭만 적는다.
   * 러너의 보고라 version · updated_at은 그대로 둔다 (관리자의 고치기가 막히지 않게). 늦게 온 옛 결과는 덮지 않는다
   */
  async noteCheck(
    spaceId: string,
    toolId: string,
    catalog: readonly ToolLine[] | null,
    error: string | null,
    at: Date,
  ): Promise<void> {
    await this.sql`
      UPDATE task.external_tools
      SET checked_at = ${at}, check_error = ${error},
        catalog = ${catalog === null ? this.sql`catalog` : this.sql`${this.sql.json(catalog as never)}`}
      WHERE space_id = ${spaceId} AND id = ${toolId} AND (checked_at IS NULL OR checked_at <= ${at})`;
  }

  /** 에이전트의 일에서 부른 커넥터 (이름으로). 마지막 사용 · 실패만 앞으로 민다. version · updated_at은 그대로 */
  async noteUsage(spaceId: string, calls: readonly ToolCalls[], at: Date): Promise<void> {
    for (const c of calls)
      await this.sql`
        UPDATE task.external_tools
        SET last_used_at = GREATEST(coalesce(last_used_at, ${at}), ${at}),
          last_failed_at = ${c.failures > 0 ? this.sql`GREATEST(coalesce(last_failed_at, ${at}), ${at})` : this.sql`last_failed_at`},
          last_error = ${c.failures > 0 ? c.error : this.sql`last_error`}
        WHERE space_id = ${spaceId} AND name = ${c.name}`;
  }

  /**
   * 확인할 때가 된 켜진 도구 (모든 공간): 확인한 적 없음 · 확인 뒤에 고침(주소 · 토큰 · 켜기) · 하루 지남.
   * 기다리는 확인이 있는지는 부르는 쪽이 작업 묶음에서 본다
   */
  async due(now: Date, limit: number): Promise<readonly ExternalTool[]> {
    const day = new Date(now.getTime() - ExternalToolRepository.RECHECK_MS);
    const rows = await this.sql<ExternalToolRow[]>`
      SELECT * FROM task.external_tools
      WHERE status = ${ExternalTool.ACTIVE}
        AND (checked_at IS NULL OR checked_at < updated_at OR checked_at < ${day})
      ORDER BY checked_at NULLS FIRST, id LIMIT ${limit}`;
    return rows.map((r) => this.toEntity(r)).filter((t) => t.ready);
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
