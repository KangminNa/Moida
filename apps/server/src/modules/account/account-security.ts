import { Injectable, type OnModuleInit } from '@nestjs/common';
import { type DomainEvent, Outbox, SecurityLog, type Sql } from '../platform';

// account의 사건을 보안 기록으로 옮긴다 (기획서 결정 2026-11-15 보안 화면).
// Outbox.listen으로 사건을 쓰는 같은 트랜잭션에서 남긴다: 로그인이 저장되면 기록도 남고, 실패하면 둘 다 없다.
// 사건 이름 → 기록 종류. 내용에는 짧은 값만 옮긴다 (토큰 · 해시는 사건에도 없다).
// 틀린 · 막힌 로그인과 서버 러너 연결은 저장할 엔티티의 사건이 없어 그 Service가 SecurityLog에 바로 남긴다.
@Injectable()
export class AccountSecurity implements OnModuleInit {
  private static readonly KINDS: Readonly<
    Record<string, (data: Record<string, unknown>) => string>
  > = {
    'account.login.succeeded': () => 'login.succeeded',
    'account.session.ended': (d) => (d.how === 'logout' ? 'session.logout' : 'session.ended'),
    'account.password.changed': () => 'password.changed',
    'account.login.changed': () => 'login.changed',
    'account.device.connected': () => 'device.connected',
    'account.device.revoked': (d) =>
      d.reason === 'token_reused' ? 'device.token_reused' : 'device.revoked',
  };

  onModuleInit(): void {
    Outbox.listen('account-security', (tx, events) => AccountSecurity.record(tx, events));
  }

  private static async record(tx: Sql, events: readonly DomainEvent[]): Promise<void> {
    const log = new SecurityLog(tx);
    for (const event of events) {
      const kindOf = AccountSecurity.KINDS[event.name];
      if (!kindOf) continue;
      const d = event.data;
      await log.record({
        space_id: event.spaceId,
        kind: kindOf(d),
        ip: AccountSecurity.text(d.ip),
        user_agent: AccountSecurity.text(d.userAgent),
        detail: {
          method: AccountSecurity.text(d.method) ?? AccountSecurity.text(d.how),
          device: AccountSecurity.text(d.name),
          reason: AccountSecurity.text(d.via),
        },
      });
    }
  }

  private static text(value: unknown): string | null {
    return typeof value === 'string' && value !== '' ? value : null;
  }
}
