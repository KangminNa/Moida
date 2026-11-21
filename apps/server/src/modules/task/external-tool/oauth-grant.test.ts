import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { ExternalFailure, RuleViolation, SecretBox } from '../../platform';
import { OAuthGrant, OAuthStop } from './oauth-grant.policy';
import type { OAuthServer } from './oauth-metadata.policy';

// 승인 코드 + PKCE의 규칙 (C1). DB · 바깥 없이 돈다.

const NOW = new Date('2026-11-21T00:00:00Z');
const TOOL = '0193a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';
const box = SecretBox.fromEnv({ CAIRN_SECRET_KEY: SecretBox.newKey() });
const server: OAuthServer = {
  issuer: 'https://auth.example.com',
  authorization_endpoint: 'https://auth.example.com/authorize?tenant=a',
  token_endpoint: 'https://auth.example.com/token',
  registration_endpoint: 'https://auth.example.com/register',
  scope: 'read write',
  client_id: 'client-1',
  redirect_uri: 'https://blog.example.com/api/external-tools/oauth/callback',
};
const ok = (body: Record<string, unknown>) => ({ status: 200, body });

describe('PKCE와 state (OAuthGrant)', () => {
  test('S256은 RFC 7636의 예와 같다', () => {
    assert.equal(
      OAuthGrant.challenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'),
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
  });

  test('state는 커넥터 id와 무작위, 검증값은 43자. 매번 다르다', () => {
    const a = OAuthGrant.begin(TOOL);
    const b = OAuthGrant.begin(TOOL);
    assert.equal(OAuthGrant.toolOf(a.state), TOOL);
    assert.equal(a.verifier.length, 43);
    assert.notEqual(a.state, b.state);
    assert.notEqual(a.verifier, b.verifier);
    for (const bad of ['', 'x', `${TOOL}.short`, `${TOOL.toUpperCase()}.${'a'.repeat(43)}`])
      assert.equal(OAuthGrant.toolOf(bad), null, bad);
  });

  test('싸 둔 로그인은 같은 state · 같은 용도 · 10분 안에만 검증값을 준다', () => {
    const { state, verifier } = OAuthGrant.begin(TOOL);
    const purpose = OAuthGrant.purposeOf(TOOL);
    const packed = box.pack(
      purpose,
      OAuthGrant.pending(state, verifier),
      OAuthGrant.LOGIN_SECONDS,
      NOW,
    );
    assert.equal(OAuthGrant.verifierOf(box.unpack(purpose, packed, NOW), state), verifier);
    const other = OAuthGrant.begin(TOOL).state;
    assert.equal(
      OAuthGrant.verifierOf(box.unpack(purpose, packed, NOW), other),
      null,
      '다른 state',
    );
    const late = new Date(NOW.getTime() + 601_000);
    assert.equal(
      OAuthGrant.verifierOf(box.unpack(purpose, packed, late), state),
      null,
      '10분 지남',
    );
    const elsewhere = OAuthGrant.purposeOf('0193a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c');
    assert.equal(
      OAuthGrant.verifierOf(box.unpack(elsewhere, packed, NOW), state),
      null,
      '다른 커넥터',
    );
    assert.equal(OAuthGrant.verifierOf(null, state), null);
  });

  test('로그인 주소: 승인 코드 · client_id · 돌아올 주소 · S256 · state · resource · scope, 원래 쿼리는 둔다', () => {
    const { state, verifier } = OAuthGrant.begin(TOOL);
    const url = new URL(
      OAuthGrant.authorizeUrl(server, state, verifier, 'https://mcp.example.com/mcp'),
    );
    assert.equal(url.origin + url.pathname, 'https://auth.example.com/authorize');
    const q = Object.fromEntries(url.searchParams);
    assert.deepEqual(q, {
      tenant: 'a',
      response_type: 'code',
      client_id: 'client-1',
      redirect_uri: server.redirect_uri,
      code_challenge: OAuthGrant.challenge(verifier),
      code_challenge_method: 'S256',
      state,
      resource: 'https://mcp.example.com/mcp',
      scope: 'read write',
    });
    const bare = new URL(OAuthGrant.authorizeUrl({ ...server, scope: null }, state, verifier, 'r'));
    assert.equal(bare.searchParams.has('scope'), false);
  });

  test('승인 코드 · 갱신 요청의 폼', () => {
    const code = OAuthGrant.codeForm(server, 'c-1', 'v-1', 'https://mcp.example.com/mcp');
    assert.deepEqual(Object.fromEntries(code), {
      grant_type: 'authorization_code',
      code: 'c-1',
      redirect_uri: server.redirect_uri,
      client_id: 'client-1',
      code_verifier: 'v-1',
      resource: 'https://mcp.example.com/mcp',
    });
    const refresh = OAuthGrant.refreshForm(server, 'r-1', 'https://mcp.example.com/mcp');
    assert.equal(refresh.get('grant_type'), 'refresh_token');
    assert.equal(refresh.get('refresh_token'), 'r-1');
    assert.equal(refresh.has('code_verifier'), false);
  });

  test('돌아온 iss가 있으면 시작한 로그인 서버여야 한다 (끝의 /는 같게 본다)', () => {
    OAuthGrant.assertIssuer(server, null);
    OAuthGrant.assertIssuer(server, 'https://auth.example.com/');
    assert.throws(() => OAuthGrant.assertIssuer(server, 'https://evil.example.com'), OAuthStop);
  });
});

describe('토큰 답 (OAuthGrant.tokens)', () => {
  test('접근 · 갱신 토큰을 묶고, 끝나기 10분 전에 갱신한다', () => {
    const t = OAuthGrant.tokens(
      ok({ access_token: 'at-1', token_type: 'Bearer', expires_in: 3600, refresh_token: 'rt-1' }),
      null,
      NOW,
    );
    assert.equal(OAuthGrant.accessOf(t.bundle), 'at-1');
    assert.equal(OAuthGrant.refreshOf(t.bundle), 'rt-1');
    assert.equal(t.expiresAt?.toISOString(), '2026-11-21T01:00:00.000Z');
    assert.equal(t.refreshAt?.toISOString(), '2026-11-21T00:50:00.000Z');
  });

  test('수명이 짧으면 절반에, 갱신 토큰이 없으면 끝날 때, 끝을 모르면 다시 보지 않는다', () => {
    const short = OAuthGrant.tokens(
      ok({ access_token: 'a', expires_in: 300, refresh_token: 'r' }),
      null,
      NOW,
    );
    assert.equal(short.refreshAt?.toISOString(), '2026-11-21T00:02:30.000Z');
    const once = OAuthGrant.tokens(ok({ access_token: 'a', expires_in: '600' }), null, NOW);
    assert.equal(once.refreshAt?.toISOString(), once.expiresAt?.toISOString());
    assert.equal(OAuthGrant.refreshOf(once.bundle), null);
    const forever = OAuthGrant.tokens(ok({ access_token: 'a', refresh_token: 'r' }), null, NOW);
    assert.equal(forever.expiresAt, null);
    assert.equal(forever.refreshAt, null);
  });

  test('갱신 답에 새 갱신 토큰이 없으면 쓰던 것을 둔다', () => {
    const t = OAuthGrant.tokens(ok({ access_token: 'at-2', expires_in: 3600 }), 'rt-old', NOW);
    assert.equal(OAuthGrant.refreshOf(t.bundle), 'rt-old');
  });

  test('거절은 RuleViolation(오류 이름만), 서버 탈은 ExternalFailure, 모양이 틀리면 거절', () => {
    assert.throws(
      () =>
        OAuthGrant.tokens(
          { status: 400, body: { error: 'invalid_grant', error_description: 'x' } },
          null,
          NOW,
        ),
      (e: unknown) =>
        e instanceof RuleViolation && /invalid_grant/.test(e.message) && !/\bx\b/.test(e.message),
    );
    assert.throws(() => OAuthGrant.tokens({ status: 401, body: null }, null, NOW), RuleViolation);
    for (const status of [500, 503, 429])
      assert.throws(() => OAuthGrant.tokens({ status, body: null }, null, NOW), ExternalFailure);
    for (const body of [
      {},
      { access_token: 'has space' },
      { access_token: 'a\nb' },
      { access_token: 'a', token_type: 'mac' },
    ])
      assert.throws(
        () => OAuthGrant.tokens(ok(body), null, NOW),
        RuleViolation,
        JSON.stringify(body),
      );
  });

  test('실패 까닭은 한 줄 300자, 멈춘 까닭은 짧은 이름', () => {
    assert.equal(OAuthGrant.errorOf(new Error(`a\n${'b'.repeat(400)}`)).length, 300);
    assert.equal(OAuthStop.reasonOf(new OAuthStop(OAuthStop.DENIED, '취소')), 'denied');
    assert.equal(OAuthStop.reasonOf(new ExternalFailure('바깥')), 'token');
  });
});
