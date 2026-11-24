import { ExternalFailure } from '../../platform';
import { PublicHttpsGateway } from '../web/public-https.gateway';

/** 로그인 서버의 답 한 번: 상태 코드 · JSON 본문(JSON이 아니면 null) · 넘어갈 주소 */
class OAuthAnswer {
  constructor(
    readonly status: number,
    readonly body: unknown,
    readonly location: string | null,
  ) {}
}

// OAuth 커넥터(C1)가 로그인 서버를 부르는 길 하나: 보호된 자원 정보 · 로그인 서버 정보 · 동적 등록 · 토큰 받기 · 갱신.
// 바깥에 붙는 규칙(https만 · 내부망 막기 · 확인한 주소로만)은 PublicHttpsGateway가 맡는다.
// 리다이렉트는 GET만 MAX_HOPS번까지 따라가고 매번 다시 확인한다 (https가 아니면 멈춘다). POST(등록 · 토큰)는 따라가지 않는다.
// 한도: 시간 timeoutMs, 답 MAX_BYTES. 본문 · 토큰 · 폼은 로그와 오류 글에 싣지 않는다.
// 시험에서만(TEST_LOOPBACK_ENV=1) 127.0.0.1 · [::1]를 그대로 적은 주소의 가짜 서버를 열고, 그 주소는 https 대신 http로 말한다
export class OAuthGateway extends PublicHttpsGateway {
  static readonly MAX_BYTES = 256 * 1024;
  static readonly MAX_HOPS = 3;
  protected readonly name = 'OAuth 로그인 서버';
  protected readonly agent = 'Cairn/1.0 (MCP OAuth client)';
  protected override readonly timeoutMs = 10_000;

  /** 주소들을 차례로 GET해 처음으로 200과 JSON을 준 곳의 본문. 모두 없으면(404 등) null */
  async firstJson(urls: readonly URL[]): Promise<unknown> {
    for (const url of urls) {
      const answer = await this.get(url);
      if (answer.status === 200 && answer.body !== null) return answer.body;
    }
    return null;
  }

  /** JSON 본문을 POST (동적 등록) */
  postJson(url: URL, body: object): Promise<OAuthAnswer> {
    return this.send(url, 'POST', 'application/json', JSON.stringify(body));
  }

  /** 폼을 POST (토큰 받기 · 갱신) */
  postForm(url: URL, form: URLSearchParams): Promise<OAuthAnswer> {
    return this.send(url, 'POST', 'application/x-www-form-urlencoded', form.toString());
  }

  private async get(start: URL): Promise<OAuthAnswer> {
    let url = start;
    for (let hop = 0; hop <= OAuthGateway.MAX_HOPS; hop++) {
      const answer = await this.send(url, 'GET', null, null);
      if (answer.status < 300 || answer.status >= 400 || !answer.location) return answer;
      url = new URL(answer.location, url);
    }
    throw new ExternalFailure(
      `다른 주소로 ${OAuthGateway.MAX_HOPS}번 넘게 넘어가요 (${start.host})`,
    );
  }

  private async send(
    url: URL,
    method: string,
    type: string | null,
    body: string | null,
  ): Promise<OAuthAnswer> {
    const target = await this.pin(url);
    const headers = { accept: 'application/json', ...(type ? { 'content-type': type } : {}) };
    return this.call(async (signal) => {
      const res = await this.open(target, method, headers, body, signal);
      const text = (await PublicHttpsGateway.readAll(res, OAuthGateway.MAX_BYTES)).toString('utf8');
      const location = res.headers.location;
      return new OAuthAnswer(res.statusCode ?? 0, PublicHttpsGateway.json(text), location ?? null);
    });
  }
}
