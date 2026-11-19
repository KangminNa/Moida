import { createHmac, timingSafeEqual } from 'node:crypto';
import type { SecretBox } from '../../platform';

// 도메인 연결 확인의 값 (스토어 3-0, docs/스토어.md 11장). 서버 키에서 'app-domain'으로 나눈 열쇠로 "앱 id:도메인"을 서명한 글자다.
// 앱 도메인의 /.well-known/cairn-domain이 이 값을 내고, 관리자의 브라우저가 그 값을 읽어 기본 도메인으로 다시 보낸다 (AppService.checkDomain).
// 값이 맞으면 그 도메인으로 온 요청이 이 서버에 닿는다는 뜻이다. 서버는 밖으로 요청하지 않는다 (내부망으로 요청을 보내는 길을 만들지 않게).
// 같은 앱 · 도메인이면 늘 같은 값이라 누구에게 보여도 된다: 다른 도메인 · 다른 앱의 값은 서버 키 없이 만들 수 없다.
export class AppDomainProof {
  private static readonly LABEL = 'app-domain';

  constructor(private readonly box: SecretBox) {}

  tokenOf(appId: string, domain: string): string {
    return createHmac('sha256', this.box.derive(AppDomainProof.LABEL))
      .update(`${appId}:${domain}`)
      .digest('base64url');
  }

  matches(appId: string, domain: string, token: string): boolean {
    const want = Buffer.from(this.tokenOf(appId, domain));
    const got = Buffer.from(token);
    return got.length === want.length && timingSafeEqual(got, want);
  }
}
