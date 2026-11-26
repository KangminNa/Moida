import { randomBytes } from 'node:crypto';
import {
  type Actor,
  AttemptLimiter,
  Command,
  NotFound,
  Operation,
  RuleViolation,
  type Work,
} from '../../../apps/server/src/plugin-api';
import { MailMessage } from './mail-message';
import { deliveries, subscribers } from './schema';
import { DoneView, SubscribedView, UnsubscribedView } from './views';

// 방문자가 하는 일 (2026-11-26, 스토어 첫 화면의 "새 글을 메일로 받기"): 구독 신청 · 확인 · 해지.
// 두 번 확인: 신청은 pending으로 남고, 일꾼이 확인 메일을 보내고(DeliverJob), 메일의 링크(스토어 화면 → 단추 → POST)를 눌러야 active.
// 주소가 이미 있는지는 답에 드러내지 않는다 (늘 "확인 메일을 보냈어요"). 해지하면 줄을 바로 지운다 (원칙 2 예외: 개인정보)

/** 확인 · 해지 링크의 열쇠: 32바이트 base64url (43자). 한 번의 신청에 하나 */
export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

const TOKEN = /^[A-Za-z0-9_-]{43}$/;

type SubscribeInput = { apps: readonly string[]; address: string; agree: boolean };

/** POST /api/p/email/subscribe: 메일 주소와 앱 주소들 (방문자). 공개 앱만, 곳마다 시간당 10번 */
export class Subscribe extends Command<SubscribeInput> {
  readonly name = 'subscribe';
  readonly allow = Operation.ANYONE;
  /** 앱 하나 · 주소 하나에 확인 메일을 다시 보내기까지 기다리는 시간 */
  static readonly RESEND_MS = 24 * 60 * 60_000;
  private static readonly APPS_MAX = 20;
  private static readonly places = new AttemptLimiter(10, 60 * 60_000);

  constructor(private readonly open: boolean) {
    super();
  }

  input(raw: unknown): SubscribeInput {
    return this.fields(raw, (f) => {
      const apps = f.optionalTextList('apps', Subscribe.APPS_MAX, 60) ?? [];
      if (apps.length === 0) f.reject('apps', '앱을 하나 이상 골라요');
      for (const slug of apps)
        if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) f.reject('apps', '앱 주소 모양이 아니에요');
      return {
        apps: [...new Set(apps)],
        address: f.text('address', 254).trim().toLowerCase(),
        agree: f.boolean('agree'),
      };
    });
  }

  async run(work: Work, _actor: Actor, input: SubscribeInput): Promise<DoneView> {
    if (!this.open) throw new NotFound('메일 구독을 받지 않아요');
    if (!input.agree) throw new RuleViolation('메일 주소를 새 글 소식에 쓰는 데 동의해야 구독돼요');
    if (!MailMessage.isAddress(input.address)) throw new RuleViolation('메일 주소 모양이 아니에요');
    if (work.place) Subscribe.places.hit(work.place);
    const ids = await work.lookup('app-id', input.apps);
    const names = await work.lookup('app', [...ids.values()]);
    if (names.size === 0) throw new NotFound('구독할 공개 앱이 없어요');
    const token = newToken();
    const now = Date.now();
    for (const [appId, appName] of names) {
      const found = await work.row(subscribers, { app_id: appId, address: input.address });
      if (!found) {
        await work.insertRows(subscribers, {
          app_id: appId,
          app_name: appName.slice(0, 100),
          address: input.address,
          status: 'pending',
          token,
        });
        continue;
      }
      // 아직 확인하지 않은 신청은 하루가 지났으면 새 열쇠로 다시 보낸다. 이미 구독 중이면 그대로 (답은 같다)
      const sentAt = found.confirm_sent_at?.getTime() ?? 0;
      if (found.status === 'pending' && now - sentAt > Subscribe.RESEND_MS)
        await work.updateRows(
          subscribers,
          { token, confirm_sent_at: null, app_name: appName.slice(0, 100) },
          { id: found.id },
        );
    }
    return new DoneView(true);
  }
}

type TokenInput = { token: string };

function tokenOf(raw: unknown): TokenInput {
  const token = String((raw as { token?: unknown } | null)?.token ?? '');
  if (!TOKEN.test(token)) throw new NotFound('확인할 구독이 없어요');
  return { token };
}

/** POST /api/p/email/confirm/:token: 확인 메일의 링크 (방문자). 그 신청의 앱들이 함께 active */
export class Confirm extends Command<TokenInput> {
  readonly name = 'confirm';
  readonly allow = Operation.ANYONE;

  input(raw: unknown): TokenInput {
    return tokenOf(raw);
  }

  async run(work: Work, _actor: Actor, input: TokenInput): Promise<SubscribedView> {
    const rows = await work.rows(subscribers, { token: input.token });
    if (rows.length === 0) throw new NotFound('확인할 구독이 없어요 (해지했거나 7일이 지났어요)');
    await work.updateRows(
      subscribers,
      { status: 'active', confirmed_at: new Date() },
      { token: input.token, status: 'pending' },
    );
    return new SubscribedView(rows.map((r) => r.app_name));
  }
}

/** POST /api/p/email/unsubscribe/:token: 메일의 해지 링크 · 원클릭 해지 (방문자). 줄을 지우고 아직 보내지 않은 소식도 뺀다 */
export class Unsubscribe extends Command<TokenInput> {
  readonly name = 'unsubscribe';
  readonly allow = Operation.ANYONE;

  input(raw: unknown): TokenInput {
    return tokenOf(raw);
  }

  async run(work: Work, _actor: Actor, input: TokenInput): Promise<UnsubscribedView> {
    const rows = await work.rows(subscribers, { token: input.token });
    for (const r of rows)
      await work.deleteRows(deliveries, { subscriber_id: r.id, status: 'queued' });
    await work.deleteRows(subscribers, { token: input.token });
    return new UnsubscribedView(rows.map((r) => r.app_name));
  }
}
