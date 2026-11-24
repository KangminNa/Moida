import { Injectable } from '@nestjs/common';
import { type Actor, BaseQuery, Database, Forbidden, NotFound } from '../../platform';
import type { SkillRevisionRow, SkillRow } from '../task.tables';
import { PromptTemplates } from './prompt-templates';
import { RepoSkillGateway } from './repo-skill.gateway';
import {
  SkillDetailView,
  SkillListView,
  SkillRevisionView,
  type SkillScoreRow,
  SkillScoreView,
  SkillSummaryView,
} from './skill.view';
import { SkillFiles } from './skill-files';
import { SkillScore } from './skill-score.policy';

/** 스킬 줄과 지금 쓰는 콘솔 판의 해시 · 바탕 */
interface SkillWithActive extends SkillRow {
  active_hash: string | null;
  active_based_on: string | null;
}

// 콘솔 "스킬" 메뉴의 읽기 (주인만). 목록은 저장소의 러너 스킬마다 한 줄이고, 콘솔 판이 있으면 그 판을 보인다.
@Injectable()
export class SkillQuery extends BaseQuery {
  constructor(
    db: Database,
    private readonly repo: RepoSkillGateway,
  ) {
    super(db);
  }

  async list(actor: Actor): Promise<SkillListView> {
    actor.assertOwner();
    const rows = await this.rowsOf(actor.requireSpace());
    return new SkillListView(
      [...this.repo.all()].map(([name, files]) =>
        this.summary(name, files, rows.get(name) ?? null),
      ),
    );
  }

  async detail(actor: Actor, name: string): Promise<SkillDetailView> {
    actor.assertOwner();
    const spaceId = actor.requireSpace();
    const repo = this.runnerSkill(name);
    const row = (await this.rowsOf(spaceId, name)).get(name) ?? null;
    const revisions = row
      ? await this.sql<SkillRevisionRow[]>`
          SELECT * FROM task.skill_revisions WHERE skill_id = ${row.id} ORDER BY revision DESC`
      : [];
    const active = revisions.find((r) => r.revision === row?.active_revision);
    return new SkillDetailView(
      this.summary(name, repo, row),
      active ? (active.files as Record<string, string>) : repo.toRecord(),
      repo.hash,
      repo.toRecord(),
      revisions,
      (await this.scores(spaceId, name, new Date())).map(
        (r) => new SkillScoreView(r, SkillScore.settled(r.done + r.failed)),
      ),
      { days: SkillScore.DAYS, minFinished: SkillScore.MIN_FINISHED },
    );
  }

  /**
   * 버전마다의 성적 (SkillScore): 최근 기간에 이 스킬로 처음 실행한 일을 그 실행의 버전(출처 · 번호 · 해시)으로 묶어
   * 끝냄 · 실패, 관리자의 수정 요청 · 반려 없이 끝낸 일, 일 하나의 수정 요청 · 반려 · 실행 수, 끝낸 일의 토큰을 센다
   */
  private async scores(spaceId: string, name: string, now: Date): Promise<SkillScoreRow[]> {
    const since = SkillScore.since(now);
    return this.sql<SkillScoreRow[]>`
      WITH firsts AS (
        SELECT DISTINCT ON (r.task_id) r.task_id, r.skill_source, r.skill_revision, r.skill_hash,
          r.started_at
        FROM task.task_runs r
        WHERE r.space_id = ${spaceId} AND r.skill = ${name} AND r.started_at >= ${since}
        ORDER BY r.task_id, r.seq
      ), per_task AS (
        SELECT f.*, t.status,
          (SELECT count(*) FROM task.task_runs x WHERE x.task_id = f.task_id)::int AS runs,
          (SELECT count(*) FROM task.approvals a
            WHERE a.task_id = f.task_id AND NOT a.agent_decided
              AND a.status IN ('revision_requested', 'rejected')
              AND a.action <> ALL(${SkillScore.skipped()}::text[]))::int AS sent_back,
          (SELECT coalesce(sum(e.tokens), 0) FROM task.task_events e
            WHERE e.task_id = f.task_id)::float8 AS tokens
        FROM firsts f JOIN task.tasks t ON t.id = f.task_id
      )
      SELECT skill_source AS source, skill_revision AS revision, skill_hash AS hash,
        count(*)::int AS tasks,
        count(*) FILTER (WHERE status = 'done')::int AS done,
        count(*) FILTER (WHERE status = 'failed')::int AS failed,
        count(*) FILTER (WHERE status = 'done' AND sent_back = 0)::int AS first_pass,
        round(avg(sent_back)::numeric, 2)::float8 AS avg_fixes,
        round(avg(runs)::numeric, 2)::float8 AS avg_runs,
        CASE WHEN count(*) FILTER (WHERE status = 'done') > 0 THEN
          round(sum(tokens) FILTER (WHERE status = 'done') / count(*) FILTER (WHERE status = 'done'))::int
        END AS tokens_per_done,
        max(started_at) AS last_used
      FROM per_task
      GROUP BY skill_source, skill_revision, skill_hash
      ORDER BY max(started_at) DESC`;
  }

  async revision(actor: Actor, name: string, revision: number): Promise<SkillRevisionView> {
    actor.assertOwner();
    this.runnerSkill(name);
    if (!Number.isInteger(revision) || revision < 1)
      throw new NotFound(`없는 버전이에요: ${revision}`);
    const [row] = await this.sql<SkillRevisionRow[]>`
      SELECT r.* FROM task.skill_revisions r JOIN task.skills s ON s.id = r.skill_id
      WHERE s.space_id = ${actor.requireSpace()} AND s.name = ${name} AND r.revision = ${revision}`;
    if (!row) throw new NotFound(`없는 버전이에요: ${revision}`);
    return new SkillRevisionView(row);
  }

  /** 저장소의 러너 스킬. 아니면 404 */
  private runnerSkill(name: string): SkillFiles {
    const files = this.repo.get(name);
    if (!files) throw new NotFound(`러너 스킬이 아니에요: ${name}`);
    return files;
  }

  private summary(name: string, repo: SkillFiles, row: SkillWithActive | null): SkillSummaryView {
    const consoleActive = row?.active_revision != null && row.active_hash !== null;
    return new SkillSummaryView(
      name,
      repo.description,
      row,
      consoleActive ? (row.active_hash as string) : repo.hash,
      consoleActive && row.active_based_on !== repo.hash,
    );
  }

  /**
   * AI에게 가는 지시문 틀의 지금 판 (cairn-runner: 콘솔 판, 그 판에 없는 틀은 저장소 판).
   * 서버가 만드는 지시(목표 실행의 회차 지시 · read_url의 알림)가 쓴다. 지시문 글이라 누구든 자기 공간의 것을 읽는다 (일꾼은 공간을 받아서)
   */
  async prompts(actor: Actor, spaceId: string): Promise<PromptTemplates> {
    if (actor.spaceId !== null && actor.spaceId !== spaceId) throw new Forbidden('space');
    const [active] = await this.sql<SkillRevisionRow[]>`
      SELECT r.* FROM task.skills s
      JOIN task.skill_revisions r ON r.skill_id = s.id AND r.revision = s.active_revision
      WHERE s.space_id = ${spaceId} AND s.name = ${PromptTemplates.SKILL}`;
    return PromptTemplates.layered(
      active ? SkillFiles.trusted(active.files as Record<string, string>) : null,
      this.runnerSkill(PromptTemplates.SKILL),
    );
  }

  private async rowsOf(
    spaceId: string,
    name?: string,
  ): Promise<ReadonlyMap<string, SkillWithActive>> {
    const rows = await this.sql<SkillWithActive[]>`
      SELECT s.*, r.hash AS active_hash, r.based_on AS active_based_on
      FROM task.skills s
      LEFT JOIN task.skill_revisions r ON r.skill_id = s.id AND r.revision = s.active_revision
      WHERE s.space_id = ${spaceId} ${name === undefined ? this.sql`` : this.sql`AND s.name = ${name}`}`;
    return new Map(rows.map((r) => [r.name, r]));
  }
}
