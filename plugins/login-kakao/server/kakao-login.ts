import { BaseLogin, LoginIdentity, RuleViolation } from '../../../apps/server/src/plugin-api';
import type { KakaoLoginGateway } from './kakao-login.gateway';

// 카카오로 로그인. 누구인지(카카오 회원번호)만 코어에 알려준다. 동의 항목(닉네임 · 이메일)은 요청하지 않는다 (최소 수집).
// 회원인지 · 주인인지는 코어가 정한다 (커뮤니티는 회원번호로 회원을 찾고, 주인은 먼저 연결해 둔 계정만).
export class KakaoLogin extends BaseLogin {
  readonly label = '카카오로 로그인';

  constructor(private readonly kakao: KakaoLoginGateway) {
    super();
  }

  start(callbackUrl: string, state: string): string {
    return this.kakao.authorizeUrl(callbackUrl, state);
  }

  async finish(query: ReadonlyMap<string, string>, callbackUrl: string): Promise<LoginIdentity> {
    const code = query.get('code');
    if (!code) {
      // 사용자가 카카오 화면에서 취소하면 error=access_denied로 돌아온다
      const reason = query.get('error_description') ?? query.get('error') ?? '코드가 없어요';
      throw new RuleViolation(`카카오 로그인을 끝내지 못했어요 (${reason})`);
    }
    const id = await this.kakao.memberId(await this.kakao.exchange(code, callbackUrl));
    return new LoginIdentity(id, `카카오 ${id}`);
  }
}
