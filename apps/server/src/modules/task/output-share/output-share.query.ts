import { Injectable } from '@nestjs/common';
import {
  type Actor,
  BaseQuery,
  BlobStore,
  Database,
  NotFound,
  RuleViolation,
  SecretBox,
} from '../../platform';
import { OutputPolicy } from '../output/output.policy';
import { OutputFile } from '../output/output.query';
import { outputs } from '../task.schema';
import type { OutputRow } from '../task.tables';
import { type OutputShareLine, OutputShareListView, OutputShareView } from './output-share.view';
import { ShareLink } from './share-link';

// 결과물 공유 링크 읽기 (기획서 결정 2026-11-19). 목록 · 하나는 관리자만, 링크로 여는 파일은 누구나.
// 링크가 열리는 조건은 이 파일의 SQL 한 곳: 서명이 맞고 · 끄지 않았고 · 기간 안이고 · 결과물이 휴지통에 없다.
// 열리지 않는 까닭은 밖에 알리지 않는다 (없는 링크와 같은 404)
@Injectable()
export class OutputShareQuery extends BaseQuery {
  private static readonly LIST_MAX = 100;
  private static readonly MISSING = '없거나 끝난 공유 링크예요';

  constructor(
    db: Database,
    private readonly box: SecretBox,
    private readonly blobs: BlobStore,
  ) {
    super(db);
  }

  /** 살아 있는 공유 링크, 최근부터. outputId면 그 결과물의 것만 */
  async list(actor: Actor, outputId: string | null): Promise<OutputShareListView> {
    actor.assertOwner();
    const rows = await this.sql<OutputShareLine[]>`
      SELECT s.*, o.name AS output_name FROM task.output_shares s
      JOIN task.outputs o ON o.id = s.output_id
      WHERE s.space_id = ${actor.requireSpace()} AND s.ended_at IS NULL AND s.expires_at > now()
        AND o.deleted_at IS NULL
        ${outputId === null ? this.sql`` : this.sql`AND s.output_id = ${outputId}`}
      ORDER BY s.id DESC LIMIT ${OutputShareQuery.LIST_MAX}`;
    const now = new Date();
    return new OutputShareListView(rows.map((r) => this.viewOf(r, now)));
  }

  /** 하나 (만들기 · 끄기의 답). 끝난 링크도 */
  async one(actor: Actor, id: string): Promise<OutputShareView> {
    actor.assertOwner();
    const [row] = await this.sql<OutputShareLine[]>`
      SELECT s.*, o.name AS output_name FROM task.output_shares s
      JOIN task.outputs o ON o.id = s.output_id
      WHERE s.space_id = ${actor.requireSpace()} AND s.id = ${id}`;
    if (!row) throw new NotFound('공유 링크를 찾을 수 없어요');
    return this.viewOf(row, new Date());
  }

  /** 공유할 결과물이 이 공간에 있고 휴지통에 없는가 (만들기 전에 Service가 묻는다) */
  async assertShareable(actor: Actor, outputId: string): Promise<void> {
    actor.assertOwner();
    const row = await this.row(
      outputs,
      { space_id: actor.requireSpace(), id: outputId },
      { columns: ['deleted_at'] },
    );
    if (!row) throw new NotFound('결과물을 찾을 수 없어요');
    if (row.deleted_at) throw new RuleViolation('휴지통의 결과물은 공유할 수 없어요');
  }

  /**
   * 링크로 여는 파일 (누구나). 결과물 메뉴의 "열기"(?view=1)와 같이 연다: HTML은 격리해서, 그림 · PDF · 영상은 미리 보기,
   * 나머지는 내려받기. 열리지 않으면 까닭을 가리지 않고 404
   */
  async open(_actor: Actor, token: string): Promise<OutputFile> {
    const id = ShareLink.idOf(this.box, token);
    if (id === null) throw new NotFound(OutputShareQuery.MISSING);
    const [row] = await this.sql<OutputRow[]>`
      SELECT o.* FROM task.output_shares s
      JOIN task.outputs o ON o.id = s.output_id AND o.space_id = s.space_id
      WHERE s.id = ${id} AND s.ended_at IS NULL AND s.expires_at > now() AND o.deleted_at IS NULL`;
    if (!row) throw new NotFound(OutputShareQuery.MISSING);
    const isolated = OutputPolicy.canView(row.name);
    const inline = isolated || OutputPolicy.canInline(row.mime);
    const stream = await this.blobs.open(row.blob_hash);
    return new OutputFile(row.name, row.mime, row.size_bytes, stream, inline, isolated);
  }

  private viewOf(row: OutputShareLine, now: Date): OutputShareView {
    return new OutputShareView(row, ShareLink.path(this.box, row.id), now);
  }
}
