import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

// 테스트용 카카오 서버 (로그인 부분만). 실제 카카오 대신 이 주소를 인증 · API 주소로 넣어 로그인 흐름을 끝까지 돌린다.
//   POST /oauth/token  (form) 코드 "ok-<숫자>" → 토큰 "token-<숫자>", 그 밖의 코드는 400 invalid_grant
//   GET  /v2/user/me   토큰 "token-<숫자>" → 그 숫자 id의 회원
// 받은 마지막 토큰 요청을 남긴다 (redirect_uri · client_secret을 테스트가 본다)
export class FakeKakao {
  lastTokenForm: URLSearchParams | null = null;

  private constructor(
    private readonly server: Server,
    readonly url: string,
  ) {}

  static async start(): Promise<FakeKakao> {
    let fake: FakeKakao | null = null;
    const server = createServer(async (req, res) => {
      const send = (status: number, body: object) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
      };
      if (req.method === 'POST' && req.url === '/oauth/token') {
        let raw = '';
        for await (const chunk of req) raw += chunk;
        const form = new URLSearchParams(raw);
        if (fake) fake.lastTokenForm = form;
        const id = /^ok-(\d+)$/.exec(form.get('code') ?? '')?.[1];
        return id
          ? send(200, { access_token: `token-${id}`, token_type: 'bearer', expires_in: 21599 })
          : send(400, {
              error: 'invalid_grant',
              error_description: 'authorization code not found for code=bad',
            });
      }
      if (req.method === 'GET' && req.url === '/v2/user/me') {
        const id = /^Bearer token-(\d+)$/.exec(String(req.headers.authorization ?? ''))?.[1];
        if (!id) return send(401, { msg: 'this access token does not exist', code: -401 });
        return send(200, { id: Number(id), connected_at: '2026-11-19T00:00:00Z' });
      }
      send(404, { msg: 'not found' });
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    const { port } = server.address() as AddressInfo;
    fake = new FakeKakao(server, `http://127.0.0.1:${port}`);
    return fake;
  }

  close(): Promise<void> {
    return new Promise((done) => this.server.close(() => done()));
  }
}
