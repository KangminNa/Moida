import { Database, type DomainEvent, Outbox, RuleViolation, TableRepository } from '../../platform';
import { externalTools } from '../task.schema';
import type { ExternalToolRow } from '../task.tables';
import { ConnectorLogin } from './connector-login';
import { ExternalTool } from './external-tool';
import type { ToolCalls, ToolLine } from './tool-catalog.policy';

// task.external_tools ↔ ExternalTool. 불러오기 · 잠그기 · 저장(바뀐 칸만, version으로 늦은 쓰기를 막는다)은 기반이 한다.
export class ExternalToolRepository extends TableRepository<ExternalToolRow, ExternalTool> {
  protected readonly table = externalTools;
  protected readonly noun = '외부 도구';
  protected override readonly dueWake = [
    ExternalTool.CHECK_JOB,
    ['status', 'updated_at', 'header_name', 'secret'],
  ] as const;
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
    // 받은 목록은 승인한 목록이 되고, 기다리던 바뀐 목록은 비운다 (C3: 바뀐 것이 사라졌거나 빠지기만 했다)
    const accepted =
      catalog === null
        ? this.sql`catalog = catalog`
        : this
            .sql`catalog = ${this.sql.json(catalog as never)}, catalog_pending = NULL, catalog_changed_at = NULL`;
    await this.sql`
      UPDATE task.external_tools
      SET checked_at = ${at}, check_error = ${error}, ${accepted}
      WHERE space_id = ${spaceId} AND id = ${toolId} AND (checked_at IS NULL OR checked_at <= ${at})`;
  }

  /**
   * 승인한 목록과 다른 목록을 받았다 (C3 바뀜 감지, 2026-11-25): 승인한 목록은 두고 새 목록을 기다리게 둔다.
   * 기다리던 목록과 같으면 처음 바뀐 때를 그대로 둔다. 새로 기다리게 됐으면 true (알림을 한 번만)
   */
  async holdCatalog(
    spaceId: string,
    toolId: string,
    catalog: readonly ToolLine[],
    at: Date,
  ): Promise<boolean> {
    const json = this.sql.json(catalog as never);
    const rows = await this.sql<{ fresh: boolean }[]>`
      UPDATE task.external_tools t
      SET checked_at = ${at}, check_error = NULL, catalog_pending = ${json},
        catalog_changed_at = CASE WHEN t.catalog_pending = ${json}::jsonb THEN t.catalog_changed_at ELSE ${at} END
      FROM (SELECT id, catalog_pending FROM task.external_tools
            WHERE space_id = ${spaceId} AND id = ${toolId} FOR UPDATE) before
      WHERE t.id = before.id AND (t.checked_at IS NULL OR t.checked_at <= ${at})
      RETURNING before.catalog_pending IS DISTINCT FROM ${json}::jsonb AS fresh`;
    return rows[0]?.fresh ?? false;
  }

  /** 승인한 도구 목록 (C3: 새로 받은 목록과 비교한다). 없는 커넥터면 null */
  async approvedCatalog(
    spaceId: string,
    toolId: string,
  ): Promise<{ catalog: unknown; title: string } | null> {
    const [row] = await this.sql<{ catalog: unknown; title: string }[]>`
      SELECT catalog, title FROM task.external_tools
      WHERE space_id = ${spaceId} AND id = ${toolId} FOR UPDATE`;
    return row ?? null;
  }

  /**
   * 관리자가 바뀐 도구 목록을 승인했다 (C3): 기다리던 목록을 승인한 목록으로. 관리자가 본 바뀐 때(changedAt)와
   * 같을 때만 (그사이 또 바뀌었으면 0줄). 적었으면 true
   */
  async approveCatalog(spaceId: string, toolId: string, changedAt: Date): Promise<boolean> {
    const rows = await this.sql`
      UPDATE task.external_tools
      SET catalog = catalog_pending, catalog_pending = NULL, catalog_changed_at = NULL
      WHERE space_id = ${spaceId} AND id = ${toolId} AND catalog_pending IS NOT NULL
        AND catalog_changed_at = ${changedAt}
      RETURNING id`;
    return rows.length > 0;
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
    return rows.map((r) => this.toEntity(r)).filter((t) => t.ready(now));
  }

  /**
   * 아직 때가 안 된 켜진 커넥터 가운데 가장 이른 다시 확인 시각 (마지막 확인 + 하루). 없으면 null.
   * 때가 된 것은 지금 확인을 맡겼거나(끝나면 작업이 바뀌어 다시 잰다) 준비가 안 됐다(고치면 저장이 깨운다)
   */
  async nextCheck(): Promise<Date | null> {
    const [row] = await this.sql<Pick<ExternalToolRow, 'checked_at'>[]>`
      SELECT min(checked_at) AS checked_at FROM task.external_tools
      WHERE status = ${ExternalTool.ACTIVE} AND checked_at IS NOT NULL AND checked_at >= updated_at`;
    const last = row?.checked_at ?? null;
    return last === null ? null : new Date(last.getTime() + ExternalToolRepository.RECHECK_MS);
  }

  /** 이 이름들 가운데 공간에 없는 것 (에이전트의 허락 목록을 저장하기 전에, AgentEdit) */
  async missing(spaceId: string, names: readonly string[]): Promise<string[]> {
    const rows = await this.sql<Pick<ExternalToolRow, 'name'>[]>`
      SELECT name FROM task.external_tools WHERE space_id = ${spaceId} AND name = ANY(${[...names]}::text[])`;
    const found = new Set(rows.map((r) => r.name));
    return names.filter((n) => !found.has(n));
  }

  /** 서버 키를 바꾼 뒤 다시 잠글 것 (머리글의 토큰 · OAuth 토큰이 있는 도구 전부) */
  async lockSealed(): Promise<readonly ExternalTool[]> {
    const rows = await this.sql<ExternalToolRow[]>`
      SELECT * FROM task.external_tools WHERE secret IS NOT NULL OR token IS NOT NULL
      ORDER BY id FOR UPDATE`;
    return rows.map((r) => this.toEntity(r));
  }

  /** 커넥터의 OAuth 로그인 (C1). lock이면 줄을 잠근다. 없으면 null */
  async login(spaceId: string, id: string, lock: boolean): Promise<ConnectorLogin | null> {
    const [row] = await this.sql<ExternalToolRow[]>`
      SELECT * FROM task.external_tools WHERE space_id = ${spaceId} AND id = ${id}
      ${lock ? this.sql`FOR UPDATE` : this.sql``}`;
    return row ? ConnectorLogin.restore(row) : null;
  }

  /**
   * 로그인 칸만 적는다 (C1: 시작 · 돌아옴 · 연결 · 갱신). 버전을 올리지 않는다: 관리자의 고치기와 겨루지 않게
   * (noteCheck와 같다). 잠근 줄에서 부른다. 연결하면(updated_at) 확인을, 다시 볼 때가 바뀌면 갱신 작업을 깨운다
   */
  async saveLogin(login: ConnectorLogin): Promise<void> {
    const changes = login.unsaved;
    if (Object.keys(changes).length === 0) return;
    await this.sql`
      UPDATE task.external_tools SET ${this.sql(changes as never)}
      WHERE space_id = ${login.spaceId} AND id = ${login.id}`;
    if ('updated_at' in changes) await new Outbox(this.sql).wake(ExternalTool.CHECK_JOB);
    if ('token_refresh_at' in changes) await new Outbox(this.sql).wake(ExternalTool.REFRESH_JOB);
  }

  /** 다시 볼 때가 된 OAuth 로그인 (모든 공간, 이른 것부터): 갱신 · 다시 해 보기 · 갱신 토큰 없이 끝남 */
  async refreshDue(now: Date, limit: number): Promise<readonly ConnectorLogin[]> {
    const rows = await this.sql<ExternalToolRow[]>`
      SELECT * FROM task.external_tools
      WHERE auth = ${ExternalTool.OAUTH} AND token IS NOT NULL AND token_refresh_at <= ${now}
      ORDER BY token_refresh_at, id LIMIT ${limit}`;
    return rows.map((r) => ConnectorLogin.restore(r));
  }

  /** 아직 때가 안 된 OAuth 로그인 가운데 가장 이른 다시 볼 때. 없으면 null */
  async nextRefresh(): Promise<Date | null> {
    const [row] = await this.sql<Pick<ExternalToolRow, 'token_refresh_at'>[]>`
      SELECT min(token_refresh_at) AS token_refresh_at FROM task.external_tools
      WHERE auth = ${ExternalTool.OAUTH} AND token IS NOT NULL`;
    return row?.token_refresh_at ?? null;
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
