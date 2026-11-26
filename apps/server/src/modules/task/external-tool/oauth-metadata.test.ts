import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { RuleViolation } from '../../platform';
import { OAuthMetadata, type OAuthServer } from './oauth-metadata.policy';

// 로그인 서버 찾기의 규칙 (C1: RFC 9728 · RFC 8414 · OIDC · RFC 7591). DB · 바깥 없이 돈다.

const MCP = 'https://mcp.example.com/v1/mcp';
const REDIRECT = 'https://blog.example.com/api/external-tools/oauth/callback';
const meta = (more: Record<string, unknown> = {}) => ({
  issuer: 'https://auth.example.com/tenant',
  authorization_endpoint: 'https://auth.example.com/tenant/authorize',
  token_endpoint: 'https://auth.example.com/tenant/token',
  registration_endpoint: 'https://auth.example.com/tenant/register',
  code_challenge_methods_supported: ['plain', 'S256'],
  ...more,
});
const issuer = 'https://auth.example.com/tenant';

describe('보호된 자원 정보 (RFC 9728)', () => {
  test('경로를 끼운 주소 → 뿌리', () => {
    assert.deepEqual(
      OAuthMetadata.resourceUrls(MCP).map((u) => u.href),
      [
        'https://mcp.example.com/.well-known/oauth-protected-resource/v1/mcp',
        'https://mcp.example.com/.well-known/oauth-protected-resource',
      ],
    );
    assert.deepEqual(
      OAuthMetadata.resourceUrls('https://mcp.example.com/').map((u) => u.href),
      ['https://mcp.example.com/.well-known/oauth-protected-resource'],
    );
  });

  test('로그인 서버와 범위를 읽는다. 정보가 없으면 MCP의 출처가 로그인 서버', () => {
    const found = OAuthMetadata.resource(
      {
        resource: MCP,
        authorization_servers: [issuer, 'https://other.example.com'],
        scopes_supported: ['read', 'write', 'read', 'bad scope', 7],
      },
      MCP,
    );
    assert.deepEqual(found, { issuer, scope: 'read write' });
    assert.deepEqual(OAuthMetadata.resource(null, MCP), {
      issuer: 'https://mcp.example.com',
      scope: null,
    });
    assert.deepEqual(OAuthMetadata.resource({ resource: 'https://mcp.example.com/v1' }, MCP), {
      issuer: 'https://mcp.example.com',
      scope: null,
    });
  });

  test('다른 자원의 정보 · https가 아닌 로그인 서버 · 객체가 아닌 답은 받지 않는다', () => {
    for (const body of [
      { resource: 'https://evil.example.com/v1/mcp' },
      { resource: 'https://mcp.example.com/v1/mcpx' },
      { resource: 'https://mcp.example.com/v2' },
      { authorization_servers: ['http://auth.example.com'] },
      { authorization_servers: ['https://user:pw@auth.example.com'] },
      { authorization_servers: [42] },
      ['list'],
      'text',
    ])
      assert.throws(() => OAuthMetadata.resource(body, MCP), RuleViolation, JSON.stringify(body));
  });
});

describe('로그인 서버 정보 (RFC 8414 · OIDC)', () => {
  test('경로가 있으면 RFC 8414 끼움 → OIDC 끼움 → OIDC 뒤에 붙임', () => {
    assert.deepEqual(
      OAuthMetadata.serverUrls(issuer).map((u) => u.href),
      [
        'https://auth.example.com/.well-known/oauth-authorization-server/tenant',
        'https://auth.example.com/.well-known/openid-configuration/tenant',
        'https://auth.example.com/tenant/.well-known/openid-configuration',
      ],
    );
    assert.deepEqual(
      OAuthMetadata.serverUrls('https://auth.example.com').map((u) => u.href),
      [
        'https://auth.example.com/.well-known/oauth-authorization-server',
        'https://auth.example.com/.well-known/openid-configuration',
      ],
    );
  });

  test('주소를 읽고, 등록은 로그인 서버 · 돌아올 주소가 같을 때만 다시 쓴다', () => {
    const fresh = OAuthMetadata.server(meta(), issuer, 'read', null, REDIRECT);
    assert.equal(fresh.token_endpoint, 'https://auth.example.com/tenant/token');
    assert.equal(fresh.client_id, null);
    const known: OAuthServer = { ...fresh, client_id: 'c-1', redirect_uri: REDIRECT };
    assert.equal(OAuthMetadata.server(meta(), issuer, 'read', known, REDIRECT).client_id, 'c-1');
    const moved = OAuthMetadata.server(meta(), issuer, 'read', known, 'https://new.example.com/cb');
    assert.equal(moved.client_id, null, '돌아올 주소가 바뀜');
    assert.equal(
      OAuthMetadata.server(meta({ issuer: `${issuer}/` }), issuer, null, null, REDIRECT).issuer,
      issuer,
    );
  });

  test('정보가 없음 · issuer가 다름 · S256이 없음 · https가 아닌 주소는 받지 않는다', () => {
    assert.throws(() => OAuthMetadata.server(null, issuer, null, null, REDIRECT), RuleViolation);
    for (const more of [
      { issuer: 'https://evil.example.com/tenant' },
      { issuer: undefined },
      { code_challenge_methods_supported: ['plain'] },
      { code_challenge_methods_supported: undefined },
      { token_endpoint: 'http://auth.example.com/token' },
      { authorization_endpoint: 'https://auth.example.com/a#frag' },
      { registration_endpoint: 'javascript:alert(1)' },
    ])
      assert.throws(
        () => OAuthMetadata.server(meta(more), issuer, null, null, REDIRECT),
        RuleViolation,
        JSON.stringify(more),
      );
  });
});

describe('동적 등록 (RFC 7591)', () => {
  const server = OAuthMetadata.server(meta(), issuer, 'read write', null, REDIRECT);

  test('공개 클라이언트로 등록하고 client_id만 쓴다', () => {
    assert.deepEqual(OAuthMetadata.registration(server, REDIRECT), {
      client_name: 'Moida',
      redirect_uris: [REDIRECT],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      scope: 'read write',
    });
    const done = OAuthMetadata.registered(
      server,
      { status: 201, body: { client_id: 'c-9', client_secret: 'ignored' } },
      REDIRECT,
    );
    assert.equal(done.client_id, 'c-9');
    assert.equal(done.redirect_uri, REDIRECT);
    assert.equal(JSON.stringify(done).includes('ignored'), false);
  });

  test('등록 주소가 없거나 등록이 실패하면 멈춘다', () => {
    assert.throws(
      () => OAuthMetadata.registrationUrl({ ...server, registration_endpoint: null }),
      RuleViolation,
    );
    for (const answer of [
      { status: 400, body: { error: 'invalid_client_metadata' } },
      { status: 201, body: {} },
      { status: 201, body: { client_id: 'has space' } },
    ])
      assert.throws(() => OAuthMetadata.registered(server, answer, REDIRECT), RuleViolation);
  });

  test('저장된 값은 모양이 맞을 때만 읽는다', () => {
    assert.equal(OAuthMetadata.stored({}), null);
    assert.equal(OAuthMetadata.stored(null), null);
    assert.deepEqual(OAuthMetadata.stored(server), server);
  });
});
