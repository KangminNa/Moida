import { Injectable } from '@nestjs/common';
import { type Actor, BaseQuery } from '../../platform';
import { Task } from '../task/task';
import type { RunnerRow } from '../task.tables';
import { Runner } from './runner';
import { RunnerListView, RunnerView } from './runner.view';

// 러너 읽기. 주인만. 지금 하는 일은 그 러너가 임대를 쥔 실행 중인 작업이다.
// 브라우저 표시(O-1)는 러너가 알린 값과, 그 러너가 쥔 실행 중인 브라우저 작업을 함께 본다.
@Injectable()
export class RunnerQuery extends BaseQuery {
  async list(actor: Actor): Promise<RunnerListView> {
    actor.assertOwner();
    const now = new Date();
    const rows = await this.sql<
      (RunnerRow & { task_id: string | null; task_title: string | null; browse_running: boolean })[]
    >`
      SELECT r.*, t.id AS task_id, t.title AS task_title,
        EXISTS (
          SELECT 1 FROM task.tasks b
          WHERE b.leased_by = r.device_id AND b.status = ${Task.RUNNING} AND b.kind = ${Task.BROWSE}
        ) AS browse_running
      FROM task.runners r
      LEFT JOIN LATERAL (
        SELECT id, title FROM task.tasks
        WHERE leased_by = r.device_id AND status = ${Task.RUNNING}
        ORDER BY id DESC LIMIT 1
      ) t ON true
      WHERE r.space_id = ${actor.spaceId}
      ORDER BY r.id`;
    return new RunnerListView(
      rows.map((r) => new RunnerView(r, Runner.onlineAt(r.last_seen_at, now))),
    );
  }
}
