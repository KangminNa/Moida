import { type Actor, Command, Operation, type Work } from '../../../apps/server/src/plugin-api';
import { DoneView, MailBatchView, MailItemView } from './views';

// 일꾼이 보낼 메일을 잡고(claimMail) 결과를 적는(reportMail) 자기 동작 (서버 자신, 반복 작업 deliver만 부른다, 플러그인 API 0.13).
// 바깥 호출(SMTP)은 이 둘 사이, 트랜잭션 밖에서 한다. 잡을 때 먼저 적는다: 두 일꾼이 같은 메일을 잡지 않고, 많아야 한 번 간다.
//   잡기: 7일 지난 미확인 신청 지우기 → 10분 넘게 잡혀 있던 것은 실패로 → 오늘 남은 수(하루 상한) 안에서 확인 메일 · 소식 메일
//   적기: 받는 사람마다 sent · failed, 소식마다 수를 세고 남은 것이 없으면 done

/** 소식마다 보낸 수 · 실패 수를 다시 세고, 대기열이 비었으면 끝낸다 */
async function settle(work: Work): Promise<void> {
  await work.sql`
    UPDATE email.sends s SET
      sent = (SELECT count(*) FROM email.deliveries d WHERE d.send_id = s.id AND d.status = 'sent'),
      failed = (SELECT count(*) FROM email.deliveries d WHERE d.send_id = s.id AND d.status = 'failed'),
      status = CASE WHEN EXISTS (SELECT 1 FROM email.deliveries d
                                 WHERE d.send_id = s.id AND d.status IN ('queued', 'sending'))
               THEN s.status ELSE 'done' END,
      finished_at = CASE WHEN EXISTS (SELECT 1 FROM email.deliveries d
                                      WHERE d.send_id = s.id AND d.status IN ('queued', 'sending'))
                    THEN s.finished_at ELSE now() END
    WHERE s.status = 'sending'`;
}

/** 이번에 보낼 메일들 (서버 자신) */
export class ClaimMail extends Command<Record<string, never>> {
  readonly name = 'claimMail';
  readonly allow = Operation.SYSTEM;
  static readonly BATCH = 20;

  constructor(private readonly dailyMax: number) {
    super();
  }

  input(): Record<string, never> {
    return {};
  }

  async run(work: Work, _actor: Actor): Promise<MailBatchView> {
    await work.sql`
      DELETE FROM email.subscribers WHERE status = 'pending' AND created_at < now() - interval '7 days'`;
    await work.sql`
      UPDATE email.deliveries SET status = 'failed', error = '보냈는지 알 수 없어요 (시간 초과)'
      WHERE status = 'sending' AND claimed_at < now() - interval '10 minutes'`;
    await settle(work);
    const [spent] = await work.sql<{ n: number }[]>`
      SELECT (SELECT count(*) FROM email.deliveries
              WHERE status IN ('sending', 'sent') AND claimed_at >= date_trunc('day', now()))::int
           + (SELECT count(*) FROM email.subscribers
              WHERE confirm_sent_at >= date_trunc('day', now()))::int AS n`;
    let room = Math.min(ClaimMail.BATCH, this.dailyMax - (spent?.n ?? 0));
    if (room <= 0) return new MailBatchView([]);
    const items: MailItemView[] = [];
    // 확인 메일: 한 번의 신청(token)에 한 통, 그 신청의 앱 이름들을 함께
    const confirms = await work.sql<{ token: string; address: string; app_name: string }[]>`
      UPDATE email.subscribers SET confirm_sent_at = now()
      WHERE token IN (SELECT token FROM email.subscribers
                      WHERE status = 'pending' AND confirm_sent_at IS NULL
                      ORDER BY created_at LIMIT ${room})
        AND status = 'pending' AND confirm_sent_at IS NULL
      RETURNING token, address, app_name`;
    const byToken = new Map<string, { address: string; apps: string[] }>();
    for (const c of confirms) {
      const group = byToken.get(c.token) ?? { address: c.address, apps: [] };
      group.apps.push(c.app_name);
      byToken.set(c.token, group);
    }
    for (const [token, g] of byToken)
      items.push(new MailItemView('confirm', g.address, token, g.apps, null, null, '', ''));
    room -= byToken.size;
    if (room <= 0) return new MailBatchView(items);
    const posts = await work.sql<
      {
        send_id: string;
        subscriber_id: string;
        address: string | null;
        token: string | null;
        app_name: string;
        title: string;
        link: string;
      }[]
    >`
      WITH pick AS (
        SELECT d.send_id, d.subscriber_id FROM email.deliveries d
        JOIN email.sends s ON s.id = d.send_id
        WHERE d.status = 'queued' AND s.status = 'sending'
        ORDER BY s.created_at LIMIT ${room}
        FOR UPDATE OF d SKIP LOCKED),
      claimed AS (
        UPDATE email.deliveries d SET status = 'sending', claimed_at = now()
        FROM pick WHERE d.send_id = pick.send_id AND d.subscriber_id = pick.subscriber_id
        RETURNING d.send_id, d.subscriber_id)
      SELECT c.send_id, c.subscriber_id, p.address, p.token, s.app_name, s.title, s.link
      FROM claimed c JOIN email.sends s ON s.id = c.send_id
      LEFT JOIN email.subscribers p ON p.id = c.subscriber_id AND p.status = 'active'`;
    for (const p of posts) {
      if (!p.address || !p.token) {
        await work.sql`
          UPDATE email.deliveries SET status = 'failed', error = '구독을 해지했어요'
          WHERE send_id = ${p.send_id} AND subscriber_id = ${p.subscriber_id}`;
        continue;
      }
      items.push(
        new MailItemView(
          'post',
          p.address,
          p.token,
          [p.app_name],
          p.send_id,
          p.subscriber_id,
          p.title,
          p.link,
        ),
      );
    }
    await settle(work);
    return new MailBatchView(items);
  }
}

type Result = { sendId: string; subscriberId: string; ok: boolean; error: string | null };

/** 소식 메일을 보낸 결과 (서버 자신). 확인 메일의 결과는 적지 않는다 (실패해도 다시 보내지 않고 7일 뒤 지워진다) */
export class ReportMail extends Command<{ results: readonly Result[] }> {
  readonly name = 'reportMail';
  readonly allow = Operation.SYSTEM;

  input(raw: unknown): { results: readonly Result[] } {
    return this.fields(raw, (f) => ({
      results: f.nestedList('results', ClaimMail.BATCH).map((r) => ({
        sendId: r.uuid('sendId'),
        subscriberId: r.uuid('subscriberId'),
        ok: r.boolean('ok'),
        error: r.optionalText('error', 300),
      })),
    }));
  }

  async run(work: Work, _actor: Actor, input: { results: readonly Result[] }): Promise<DoneView> {
    for (const r of input.results)
      await work.sql`
        UPDATE email.deliveries
        SET status = ${r.ok ? 'sent' : 'failed'}, error = ${r.ok ? null : r.error}, sent_at = now()
        WHERE send_id = ${r.sendId} AND subscriber_id = ${r.subscriberId} AND status = 'sending'`;
    await settle(work);
    return new DoneView(true);
  }
}
