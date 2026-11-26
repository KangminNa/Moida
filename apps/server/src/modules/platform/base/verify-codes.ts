import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import { TooManyRequests } from './errors';

/** 보낸 코드 하나: 코드는 해시로만, 남은 시도 수와 함께 */
class PendingCode {
  constructor(
    readonly hash: Buffer,
    readonly sentAt: number,
    readonly expiresAt: number,
    public tries: number,
  ) {}
}

// 메일로 보내는 6자리 인증코드 (2026-11-26, 메일 인증 가입 · 비밀번호 다시 정하기).
// 서버 메모리에만 둔다 (AttemptLimiter와 같다): 다시 켜면 비워지고, 그때는 코드를 다시 받으면 된다. DB · 로그에 남기지 않는다.
// 열쇠(용도 · 앱 · 주소)마다 하나만 살아 있다: 다시 보내면 앞의 코드는 버린다.
//   issue: 새 코드 (같은 열쇠는 RESEND_MS가 지나야, 아니면 TooManyRequests)
//   check: 맞는가. 틀리면 시도를 세고 MAX_TRIES번 틀리면 코드를 버린다 (다시 받아야 한다)
//   use: 맞은 코드를 버린다 (한 번만 쓰게, 저장이 끝난 뒤에)
export class VerifyCodes {
  static readonly TTL_MS = 10 * 60_000;
  static readonly MAX_TRIES = 5;
  static readonly RESEND_MS = 60_000;
  private static readonly KEEP_MAX = 10_000;
  private readonly codes = new Map<string, PendingCode>();

  issue(key: string, now: number = Date.now()): string {
    const last = this.live(key, now);
    if (last && now - last.sentAt < VerifyCodes.RESEND_MS) {
      const wait = Math.ceil((VerifyCodes.RESEND_MS - (now - last.sentAt)) / 1000);
      throw new TooManyRequests(`${wait}초 뒤에 다시 받을 수 있어요`);
    }
    if (this.codes.size >= VerifyCodes.KEEP_MAX) this.sweep(now);
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    this.codes.set(
      key,
      new PendingCode(VerifyCodes.hash(code), now, now + VerifyCodes.TTL_MS, VerifyCodes.MAX_TRIES),
    );
    return code;
  }

  check(key: string, code: string, now: number = Date.now()): boolean {
    const pending = this.live(key, now);
    if (!pending) return false;
    const typed = VerifyCodes.hash(code.trim());
    if (timingSafeEqual(typed, pending.hash)) return true;
    pending.tries -= 1;
    if (pending.tries <= 0) this.codes.delete(key);
    return false;
  }

  use(key: string): void {
    this.codes.delete(key);
  }

  private live(key: string, now: number): PendingCode | null {
    const pending = this.codes.get(key);
    if (!pending) return null;
    if (pending.expiresAt > now) return pending;
    this.codes.delete(key);
    return null;
  }

  private sweep(now: number): void {
    for (const [key, pending] of this.codes) if (pending.expiresAt <= now) this.codes.delete(key);
    if (this.codes.size >= VerifyCodes.KEEP_MAX) this.codes.clear();
  }

  private static hash(code: string): Buffer {
    return createHash('sha256').update(code).digest();
  }
}
