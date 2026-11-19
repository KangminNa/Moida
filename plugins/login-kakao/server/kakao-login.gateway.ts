import { BaseGateway, ExternalFailure, RuleViolation } from '../../../apps/server/src/plugin-api';

// 카카오 로그인 (REST API, 웹 흐름). 라이브러리 없이 요청 세 번: 보내기 주소 → 코드를 토큰으로 → 회원번호.
// 동의 항목(scope)은 요청하지 않는다: 회원번호(id)는 동의 없이 온다.
export class KakaoLoginGateway extends BaseGateway {
  protected readonly name = '카카오 로그인';

  constructor(
    private readonly restApiKey: string,
    private readonly clientSecret: string | null,
    private readonly authUrl: string,
    private readonly apiUrl: string,
  ) {
    super();
  }

  authorizeUrl(callbackUrl: string, state: string): string {
    const query = new URLSearchParams({
      response_type: 'code',
      client_id: this.restApiKey,
      redirect_uri: callbackUrl,
      state,
    });
    return `${this.authUrl}/oauth/authorize?${query}`;
  }

  /** 카카오가 돌려준 코드를 접근 토큰으로. 코드가 틀렸거나 만료됐으면 RuleViolation */
  async exchange(code: string, callbackUrl: string): Promise<string> {
    const form = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: this.restApiKey,
      redirect_uri: callbackUrl,
      code,
      ...(this.clientSecret ? { client_secret: this.clientSecret } : {}),
    });
    const body = await this.call(async (signal) => {
      const res = await fetch(`${this.authUrl}/oauth/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded;charset=utf-8' },
        body: form.toString(),
        signal,
      });
      // 틀린 코드는 400과 함께 error를 준다: 아래에서 까닭을 읽는다
      if (!res.ok && res.status !== 400 && res.status !== 401)
        throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as Record<string, unknown>;
    });
    if (typeof body.access_token !== 'string') {
      const reason = typeof body.error_description === 'string' ? body.error_description : '';
      throw new RuleViolation(`카카오 로그인을 끝내지 못했어요. 다시 해 주세요 (${reason})`);
    }
    return body.access_token;
  }

  /** 토큰의 카카오 회원번호 (이 앱에서의 번호) */
  async memberId(token: string): Promise<string> {
    const json = await this.call(async (signal) => {
      const res = await fetch(`${this.apiUrl}/v2/user/me`, {
        headers: { authorization: `Bearer ${token}` },
        signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as Record<string, unknown>;
    });
    if (typeof json.id !== 'number' && typeof json.id !== 'string')
      throw new ExternalFailure('예상과 다른 모양의 카카오 사용자 정보예요');
    return String(json.id);
  }
}
