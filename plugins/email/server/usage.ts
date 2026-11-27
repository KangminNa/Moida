import { type Actor, Command, Operation, type Work } from '../../../apps/server/src/plugin-api';
import type { UsageKind } from './tables';
import { TakeView } from './views';

// 메일 사용량과 한도 (2026-11-27, 사용자 "메일 사용량도 우리 무료 사용량에 맞춰서 모니터링 및 제한").
// 이 플러그인이 내보내는 모든 메일을 보내기 전에 센다 (email.usage, 날 · 달은 UTC: 메일 회사들의 하루가 대개 UTC다).
//   하루 상한(dailyMax) · 한 달 상한(monthlyMax, 0이면 없음)은 모든 메일을 합친 수다.
//   여러 명에게 가는 메일(구독 확인 · 글 소식 · 가입자 소식)은 상한의 80%까지만 쓴다: 남은 20%는 인증코드 ·
//   관리자 알림 · 자동화 결과 · 테스트 메일의 몫이라, 소식을 보내다 한도를 다 써도 가입 · 로그인이 막히지 않는다.
//   한도에 닿아 보내지 않은 메일은 blocked로 센다 (콘솔의 메일 화면이 보인다)

/** 하루 · 한 달 상한과 종류마다 쓸 수 있는 몫 */
export class MailLimits {
  /** 여러 명에게 가는 메일의 종류 */
  static readonly BULK: readonly UsageKind[] = ['confirm', 'post', 'news'];
  /** 여러 명에게 가는 메일이 쓸 수 있는 몫 (상한의 80%) */
  static readonly BULK_SHARE = 0.8;

  constructor(
    readonly dailyMax: number,
    /** 0이면 한 달 상한이 없다 */
    readonly monthlyMax: number,
  ) {}

  /** 설정 칸의 글을 숫자로: 비었거나 틀리면 기본값, 0 이하는 0 */
  static count(raw: string | undefined, fallback: number): number {
    const value = Number.parseInt(raw ?? '', 10);
    if (!Number.isInteger(value)) return fallback;
    return Math.max(0, value);
  }

  /** 이 종류가 지금 더 보낼 수 있는 수 (오늘 · 이번 달에 이미 보낸 수를 넣는다) */
  room(kind: UsageKind, today: number, month: number): number {
    const share = MailLimits.BULK.includes(kind) ? MailLimits.BULK_SHARE : 1;
    const day = Math.floor(this.dailyMax * share) - today;
    if (this.monthlyMax === 0) return Math.max(0, day);
    const monthRoom = Math.floor(this.monthlyMax * share) - month;
    return Math.max(0, Math.min(day, monthRoom));
  }
}

/** 오늘 · 이번 달에 보낸 수 (모든 종류) */
export async function spent(work: Work): Promise<{ today: number; month: number }> {
  const [row] = await work.sql<{ today: number; month: number }[]>`
    SELECT coalesce(sum(sent) FILTER (WHERE day = (now() AT TIME ZONE 'UTC')::date), 0)::int AS today,
           coalesce(sum(sent), 0)::int AS month
    FROM email.usage
    WHERE day >= date_trunc('month', now() AT TIME ZONE 'UTC')::date`;
  return { today: row?.today ?? 0, month: row?.month ?? 0 };
}

/** 오늘 이 종류로 보낸 수 · 막힌 수를 더한다 */
export async function note(
  work: Work,
  kind: UsageKind,
  sent: number,
  blocked: number,
): Promise<void> {
  if (sent === 0 && blocked === 0) return;
  await work.sql`
    INSERT INTO email.usage (day, kind, sent, blocked)
    VALUES ((now() AT TIME ZONE 'UTC')::date, ${kind}, ${sent}, ${blocked})
    ON CONFLICT (day, kind) DO UPDATE
      SET sent = email.usage.sent + EXCLUDED.sent, blocked = email.usage.blocked + EXCLUDED.blocked`;
}

/** 세기를 한 줄로 세운다: 서버와 일꾼이 동시에 마지막 한 통을 가져가지 않게 (트랜잭션이 끝나면 풀린다) */
export async function lockUsage(work: Work): Promise<void> {
  await work.sql`SELECT pg_advisory_xact_lock(hashtext('email.usage'))`;
}

type TakeInput = { kind: UsageKind };

/** 한 통을 보내도 되는지 보고 센다 (서버 자신, MailGate가 부른다). 안 되면 막힌 수만 센다 */
export class TakeMail extends Command<TakeInput> {
  readonly name = 'takeMail';
  readonly allow = Operation.SYSTEM;
  static readonly SINGLE: readonly UsageKind[] = ['code', 'notice', 'answer', 'test'];

  constructor(private readonly limits: MailLimits) {
    super();
  }

  input(raw: unknown): TakeInput {
    return this.fields(raw, (f) => {
      const kind = f.text('kind', 20) as UsageKind;
      if (!TakeMail.SINGLE.includes(kind))
        f.reject('kind', 'code · notice · answer · test 중 하나예요');
      return { kind };
    });
  }

  async run(work: Work, _actor: Actor, input: TakeInput): Promise<TakeView> {
    await lockUsage(work);
    const { today, month } = await spent(work);
    const ok = this.limits.room(input.kind, today, month) > 0;
    await note(work, input.kind, ok ? 1 : 0, ok ? 0 : 1);
    return new TakeView(ok);
  }
}

/** 한 통씩 보내는 메일(인증코드 · 알림 · 자동화 결과 · 테스트)이 보내기 전에 지나는 곳 */
export class MailGate {
  constructor(private readonly own: (operation: string, input: object) => Promise<unknown>) {}

  /** 보내도 되면 true (센다), 한도에 닿았으면 false */
  async take(kind: UsageKind): Promise<boolean> {
    const answer = (await this.own('takeMail', { kind })) as { ok?: unknown };
    return answer.ok === true;
  }
}
