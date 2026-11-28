import {
  type Actor,
  Command,
  Conflict,
  NotFound,
  Operation,
  Read,
  type Work,
} from '../../../apps/server/src/plugin-api';
import { sends, subscribers } from './schema';
import { unsubscribed } from './subscriptions';
import type { SendRow, UsageKind } from './tables';
import { MailLimits } from './usage';
import { DoneView, OverviewView, SendView, SubscriberView, UsageView } from './views';

// 새 글 소식 (2026-11-26): 앱의 글이 공개되면 소식(ready)이 생기고, 관리자가 콘솔(운영 › 메일 구독)에서
// 보내기를 눌러야 받는 사람마다 한 줄씩 대기열에 올라 일꾼이 보낸다 (원칙 7: 바깥 전송은 사람이 정한다).
// 글 하나에 소식은 한 번 (다시 공개돼도, post_id UNIQUE).

type PublishedInput = {
  spaceId: string;
  postId: string;
  appId: string | null;
  slug: string;
  title: string;
  status: string;
};

/** blog.post.published: 구독자가 있는 공개 앱의 글이면 소식 하나 (서버 자신) */
export class PostPublished extends Command<PublishedInput> {
  readonly name = 'postPublished';
  readonly allow = Operation.SYSTEM;

  /** site: 이 Moida의 바깥 주소 (앱 도메인이 없는 앱의 글 링크 앞부분). 없으면 소식을 만들지 않는다 */
  constructor(private readonly site: string | null) {
    super();
  }

  input(raw: unknown): PublishedInput {
    const app = (raw as { appId?: unknown } | null)?.appId;
    return this.fields(raw, (f) => ({
      spaceId: f.uuid('spaceId'),
      postId: f.uuid('postId'),
      appId: typeof app === 'string' ? f.uuid('appId') : null,
      slug: f.text('slug', 300),
      title: f.optionalText('title', 300) ?? '',
      status: f.text('status', 20),
    }));
  }

  async run(work: Work, _actor: Actor, input: PublishedInput): Promise<DoneView> {
    if (!this.site || !input.appId || input.status !== 'published') return new DoneView(false);
    if (await work.exists(sends, { post_id: input.postId })) return new DoneView(false);
    if (!(await work.exists(subscribers, { app_id: input.appId, status: 'active' })))
      return new DoneView(false);
    const [names, urls] = await Promise.all([
      work.lookup('app', [input.appId]),
      work.lookup('app-url', [input.appId]),
    ]);
    const name = names.get(input.appId);
    const url = urls.get(input.appId);
    if (!name || !url) return new DoneView(false);
    const base = url.startsWith('https://') ? url : `${this.site}${url}/`;
    await work.insertRows(sends, {
      space_id: input.spaceId,
      app_id: input.appId,
      app_name: name.slice(0, 100),
      post_id: input.postId,
      title: (input.title || '새 글').slice(0, 300),
      link: `${base}posts/${encodeURIComponent(input.slug)}`,
      status: 'ready',
    });
    return new DoneView(true);
  }
}

/** GET /api/p/email/overview: 메일 구독 화면 (관리자) */
export class Overview extends Read<Record<string, never>> {
  readonly name = 'overview';
  readonly allow = Operation.OWNER;
  private static readonly SENDS = 30;
  private static readonly PEOPLE = 500;

  constructor(
    private readonly ready: boolean,
    private readonly open: boolean,
    private readonly limits: MailLimits,
  ) {
    super();
  }

  input(): Record<string, never> {
    return {};
  }

  async run(work: Work, actor: Actor): Promise<OverviewView> {
    const space = actor.requireSpace();
    const recent = await work.sql<(SendRow & { waiting: number })[]>`
      SELECT s.*, (SELECT count(*)::int FROM email.subscribers p
                   WHERE p.status = 'active' AND CASE WHEN s.kind = 'news'
                     THEN p.space_id = s.space_id AND p.account_id IS NOT NULL
                     ELSE p.app_id = s.app_id END) AS waiting
      FROM email.sends s WHERE s.space_id = ${space}
      ORDER BY s.created_at DESC LIMIT ${Overview.SENDS}`;
    const people = await work.rows(
      subscribers,
      {},
      {
        order: ['created_at desc'],
        limit: Overview.PEOPLE,
      },
    );
    return new OverviewView(
      this.ready,
      this.open,
      await this.usage(work),
      recent.map((r) => new SendView(r, r.waiting)),
      people.map((p) => new SubscriberView(p)),
    );
  }

  /** 오늘(종류마다) · 이번 달 사용량과 기다리는 소식 메일 수 */
  private async usage(work: Work): Promise<UsageView> {
    const rows = await work.sql<
      { kind: UsageKind; today: boolean; sent: number; blocked: number }[]
    >`
      SELECT kind, day = (now() AT TIME ZONE 'UTC')::date AS today, sent, blocked FROM email.usage
      WHERE day >= date_trunc('month', now() AT TIME ZONE 'UTC')::date`;
    const today = new Map<UsageKind, { sent: number; blocked: number }>();
    let month = 0;
    let monthBlocked = 0;
    for (const r of rows) {
      month += r.sent;
      monthBlocked += r.blocked;
      if (r.today) today.set(r.kind, { sent: r.sent, blocked: r.blocked });
    }
    const [queued] = await work.sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM email.deliveries d JOIN email.sends s ON s.id = d.send_id
      WHERE d.status = 'queued' AND s.status = 'sending'`;
    const l = this.limits;
    return new UsageView(
      today,
      month,
      monthBlocked,
      l.dailyMax,
      l.monthlyMax,
      MailLimits.BULK_SHARE,
      queued?.n ?? 0,
    );
  }
}

type IdInput = { id: string };

function idOf(f: { uuid(name: string): string }): IdInput {
  return { id: f.uuid('id') };
}

/** POST /api/p/email/subscribers/:id/remove: 구독자 지우기 (관리자). 아직 보내지 않은 소식에서도 뺀다 */
export class RemoveSubscriber extends Command<IdInput> {
  readonly name = 'removeSubscriber';
  readonly allow = Operation.OWNER;

  input(raw: unknown): IdInput {
    return this.fields(raw, idOf);
  }

  async run(work: Work, _actor: Actor, input: IdInput): Promise<DoneView> {
    const found = await work.row(subscribers, { id: input.id });
    if (!found) throw new NotFound('없는 구독자예요');
    await work.sql`DELETE FROM email.deliveries WHERE subscriber_id = ${input.id} AND status = 'queued'`;
    await work.deleteRows(subscribers, { id: input.id });
    // 가입자의 소식 메일이면 계정의 수신 동의도 지운다 (2026-11-27)
    if (found.account_id && found.space_id)
      work.record(unsubscribed(found.space_id, found.account_id));
    return new DoneView(true);
  }
}

/** POST /api/p/email/sends/:id/start: 보내기 (관리자). 지금 구독 중인 사람마다 한 줄을 대기열에 */
export class StartSend extends Command<IdInput> {
  readonly name = 'startSend';
  readonly allow = Operation.OWNER;

  input(raw: unknown): IdInput {
    return this.fields(raw, idOf);
  }

  async run(work: Work, actor: Actor, input: IdInput): Promise<DoneView> {
    const send = await work.row(sends, { id: input.id, space_id: actor.requireSpace() });
    if (!send) throw new NotFound('없는 소식이에요');
    if (send.kind === 'news')
      throw new Conflict('가입자 소식 메일은 대화의 결과 카드에서 승인하면 나가요');
    if (send.status !== 'ready') throw new Conflict('이미 보냈거나 취소한 소식이에요');
    const queued = await work.sql<{ n: number }[]>`
      WITH added AS (
        INSERT INTO email.deliveries (send_id, subscriber_id, status)
        SELECT ${send.id}, p.id, 'queued' FROM email.subscribers p
        WHERE p.app_id = ${send.app_id} AND p.status = 'active'
        RETURNING 1)
      SELECT count(*)::int AS n FROM added`;
    const total = queued[0]?.n ?? 0;
    await work.updateRows(
      sends,
      {
        status: total > 0 ? 'sending' : 'done',
        total,
        started_at: new Date(),
        finished_at: total > 0 ? null : new Date(),
      },
      { id: send.id },
    );
    return new DoneView(true);
  }
}

/** POST /api/p/email/sends/:id/cancel: 보내지 않기 · 남은 것 멈추기 (관리자). 이미 간 메일은 되돌리지 못한다 */
export class CancelSend extends Command<IdInput> {
  readonly name = 'cancelSend';
  readonly allow = Operation.OWNER;

  input(raw: unknown): IdInput {
    return this.fields(raw, idOf);
  }

  async run(work: Work, actor: Actor, input: IdInput): Promise<DoneView> {
    const send = await work.row(sends, { id: input.id, space_id: actor.requireSpace() });
    if (!send) throw new NotFound('없는 소식이에요');
    if (send.status !== 'ready' && send.status !== 'sending' && send.status !== 'draft')
      throw new Conflict('이미 끝난 소식이에요');
    await work.sql`DELETE FROM email.deliveries WHERE send_id = ${send.id} AND status = 'queued'`;
    await work.updateRows(sends, { status: 'cancelled', finished_at: new Date() }, { id: send.id });
    return new DoneView(true);
  }
}
