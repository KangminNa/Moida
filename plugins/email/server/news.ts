import {
  Actor,
  Command,
  DomainEvent,
  NotFound,
  Operation,
  Read,
  RuleViolation,
  type Work,
} from '../../../apps/server/src/plugin-api';
import { sends, subscribers } from './schema';
import { newToken } from './subscriptions';
import { DoneView, NewsDetailView, NewsDraftView } from './views';

// 가입자 소식 메일 (2026-11-27, 사용자 "가입자 전원인데 애초에 회원가입할 때 받아" · "보낼 때마다 승인").
//   받는 사람: 가입 때(또는 내 정보에서) 소식 메일을 받기로 한 스토어 계정. 코어가 동의를 알리면(community.account.news)
//     주소를 묻고(lookup news-address, 서버 자신만) 줄을 맞춘다 (SyncAccountNews). 메일 주소는 이벤트에 실리지 않는다
//   보내기: 대표가 mail_news_draft로 제목 · 본문을 남기면(draft) 답의 send_id로 request_approval(email.news.send, 대상 email_send)을
//     올린다. 관리자가 승인하면(SendApprovedNews) 지금 받는 사람마다 한 줄씩 대기열에 올라 일꾼(deliver)이 보낸다 (원칙 7)
//   해지 링크로 끊으면 plugin.email.unsubscribed { accountId }를 남겨 코어가 동의를 지운다 (subscriptions.ts)

/** 소식 메일 보내기의 결재 동작 (대상 종류 email_send, 소식은 쓴 뒤 바뀌지 않아 대상 판은 늘 1) */
export const NEWS_ACTION = 'email.news.send';
const SUBJECT_MAX = 150;
const BODY_MAX = 20000;
const VERSION_MAX = 2_147_483_647;

/** 공간에서 소식 메일을 받는 계정 수 */
async function recipients(work: Work, spaceId: string): Promise<number> {
  const [row] = await work.sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM email.subscribers
    WHERE space_id = ${spaceId} AND account_id IS NOT NULL AND status = 'active'`;
  return row?.n ?? 0;
}

type NewsInput = { spaceId: string; accountId: string; agreed: boolean };

/** community.account.news: 계정의 수신 동의가 바뀌었다 (서버 자신). 두 번 와도 같다 */
export class SyncAccountNews extends Command<NewsInput> {
  readonly name = 'syncAccountNews';
  readonly allow = Operation.SYSTEM;

  input(raw: unknown): NewsInput {
    return this.fields(raw, (f) => ({
      spaceId: f.uuid('spaceId'),
      accountId: f.uuid('accountId'),
      agreed: f.boolean('agreed'),
    }));
  }

  async run(work: Work, _actor: Actor, input: NewsInput): Promise<DoneView> {
    // 지금 동의한 계정이면 주소를 받는다 (이벤트가 늦게 와도 코어의 지금 값을 따른다)
    const address = input.agreed
      ? (await work.lookup('news-address', [input.accountId])).get(input.accountId)
      : undefined;
    const found = await work.row(subscribers, { account_id: input.accountId });
    if (!address) {
      if (!found) return new DoneView(false);
      await work.sql`DELETE FROM email.deliveries WHERE subscriber_id = ${found.id} AND status = 'queued'`;
      await work.deleteRows(subscribers, { id: found.id });
      return new DoneView(true);
    }
    if (found) {
      if (found.address !== address)
        await work.updateRows(subscribers, { address }, { id: found.id });
      return new DoneView(false);
    }
    await work.insertRows(subscribers, {
      space_id: input.spaceId,
      account_id: input.accountId,
      address,
      status: 'active',
      token: newToken(),
      confirmed_at: new Date(),
    });
    return new DoneView(true);
  }
}

type DraftInput = { requestId: string; subject: string; body: string };

/** mail_news_draft (작업 토큰): 가입자에게 보낼 소식 메일 한 통을 남긴다. 보내지 않는다 (승인 뒤) */
export class DraftNews extends Command<DraftInput> {
  readonly name = 'draftNews';
  readonly allow = Actor.AGENT;

  input(raw: unknown): DraftInput {
    return this.fields(raw, (f) => ({
      requestId: f.text('request_id', 100),
      subject: f.text('subject', SUBJECT_MAX),
      body: f.text('body', BODY_MAX),
    }));
  }

  async run(work: Work, actor: Actor, input: DraftInput): Promise<NewsDraftView> {
    const space = actor.requireSpace();
    const requestId = `${actor.id ?? 'agent'}:${input.requestId}`;
    const people = await recipients(work, space);
    const before = await work.row(sends, { space_id: space, request_id: requestId });
    if (before) return new NewsDraftView(before, people);
    if (people === 0)
      throw new RuleViolation(
        '소식 메일을 받기로 한 가입자가 없어요 (가입 화면 · 내 정보의 "소식 메일 받기")',
      );
    const subject = input.subject.replace(/\s+/g, ' ').trim();
    const body = input.body.trim();
    if (!subject || !body) throw new RuleViolation('제목과 본문을 모두 적어요');
    await work.insertRows(sends, {
      space_id: space,
      kind: 'news',
      title: subject,
      body,
      request_id: requestId,
      status: 'draft',
    });
    const made = await work.row(sends, { space_id: space, request_id: requestId });
    if (!made) throw new Error('소식을 남기지 못했어요');
    return new NewsDraftView(made, people);
  }
}

type DecidedInput = {
  approvalId: string;
  action: string;
  spaceId: string;
  targetId: string | null;
  targetVersion: number | null;
};

/** 결재가 정해진 이벤트 (task.approval.*)의 칸 */
abstract class NewsDecision extends Command<DecidedInput> {
  readonly allow = Operation.SYSTEM;

  input(raw: unknown): DecidedInput {
    const r = (raw ?? {}) as { targetId?: unknown; targetVersion?: unknown };
    return this.fields(raw, (f) => ({
      approvalId: f.uuid('approvalId'),
      action: f.text('action', 100),
      spaceId: f.uuid('spaceId'),
      targetId: typeof r.targetId === 'string' ? f.uuid('targetId') : null,
      targetVersion:
        typeof r.targetVersion === 'number' ? f.integer('targetVersion', 0, VERSION_MAX) : null,
    }));
  }
}

/**
 * email.news.send가 승인되면 (task.approval.granted): 지금 받는 사람마다 한 줄을 대기열에 올린다.
 * 결과(plugin.email.news_started: approvalId · outcome)는 코어의 ApprovalResultHandler가 받아 기다리던 작업을 끝낸다.
 * 같은 결재가 두 번 와도 대기열은 한 번 (approval_id)
 */
export class SendApprovedNews extends NewsDecision {
  readonly name = 'sendApprovedNews';

  async run(work: Work, _actor: Actor, input: DecidedInput): Promise<DoneView> {
    if (input.action !== NEWS_ACTION) return new DoneView(false);
    const send = input.targetId
      ? await work.row(sends, { id: input.targetId, space_id: input.spaceId, kind: 'news' })
      : null;
    const again = send !== null && send.approval_id === input.approvalId;
    const problem = !send
      ? '승인한 소식 메일을 찾을 수 없어요'
      : again
        ? null
        : send.status !== 'draft'
          ? '이미 보냈거나 취소한 소식 메일이에요'
          : null;
    if (send && !again && !problem) {
      const queued = await work.sql<{ n: number }[]>`
        WITH added AS (
          INSERT INTO email.deliveries (send_id, subscriber_id, status)
          SELECT ${send.id}, p.id, 'queued' FROM email.subscribers p
          WHERE p.space_id = ${input.spaceId} AND p.account_id IS NOT NULL AND p.status = 'active'
          RETURNING 1)
        SELECT count(*)::int AS n FROM added`;
      const total = queued[0]?.n ?? 0;
      const now = new Date();
      await work.updateRows(
        sends,
        {
          status: total > 0 ? 'sending' : 'done',
          total,
          approval_id: input.approvalId,
          started_at: now,
          finished_at: total > 0 ? null : now,
        },
        { id: send.id },
      );
    }
    work.record(
      new DomainEvent('plugin.email.news_started', 1, input.spaceId, {
        approvalId: input.approvalId,
        outcome: problem ? 'failed' : 'done',
        ...(problem ? { error: problem } : {}),
      }),
    );
    return new DoneView(true);
  }
}

/** email.news.send가 반려 · 수정 요청 · 취소되면 그 소식을 보내지 않는다 (대표는 고쳐서 새로 쓴다) */
export class DropNews extends NewsDecision {
  readonly name = 'dropNews';

  async run(work: Work, _actor: Actor, input: DecidedInput): Promise<DoneView> {
    if (input.action !== NEWS_ACTION || !input.targetId) return new DoneView(false);
    await work.updateRows(
      sends,
      { status: 'cancelled', finished_at: new Date() },
      { id: input.targetId, space_id: input.spaceId, kind: 'news', status: 'draft' },
    );
    return new DoneView(true);
  }
}

/** GET /api/p/email/news/:id: 승인 화면이 보는 소식 메일 한 통 (관리자): 제목 · 본문 · 지금 받을 가입자 수 */
export class GetNews extends Read<{ id: string }> {
  readonly name = 'getNews';
  readonly allow = Operation.OWNER;

  input(raw: unknown): { id: string } {
    return this.fields(raw, (f) => ({ id: f.uuid('id') }));
  }

  async run(work: Work, actor: Actor, input: { id: string }): Promise<NewsDetailView> {
    const space = actor.requireSpace();
    const row = await work.row(sends, { id: input.id, space_id: space, kind: 'news' });
    if (!row) throw new NotFound('없는 소식 메일이에요');
    return new NewsDetailView(row, await recipients(work, space));
  }
}
