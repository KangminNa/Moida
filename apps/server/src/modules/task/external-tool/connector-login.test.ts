import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { ExternalFailure, RuleViolation, SecretBox } from '../../platform';
import type { ExternalToolRow } from '../task.tables';
import { ConnectorLogin } from './connector-login';
import { ExternalTool } from './external-tool';
import { OAuthGrant, OAuthStop } from './oauth-grant.policy';
import type { OAuthServer } from './oauth-metadata.policy';

// OAuth 커넥터 (C1): 로그인 방식 · 러너에게 건네기 · 로그인의 흐름(ConnectorLogin). DB 없이 돈다.

const NOW = new Date('2026-11-21T00:00:00Z');
const URL_ = 'https://mcp.example.com/mcp';
const box = SecretBox.fromEnv({ CAIRN_SECRET_KEY: SecretBox.newKey() });
const server: OAuthServer = {
  issuer: 'https://auth.example.com',
  authorization_endpoint: 'https://auth.example.com/authorize',
  token_endpoint: 'https://auth.example.com/token',
  registration_endpoint: null,
  scope: null,
  client_id: 'client-1',
  redirect_uri: 'https://blog.example.com/api/external-tools/oauth/callback',
};
const later = (ms: number) => new Date(NOW.getTime() + ms);

/** 저장된 OAuth 커넥터 한 줄 (save 없이 엔티티끼리 넘긴다) */
function row(more: Partial<ExternalToolRow> = {}): ExternalToolRow {
  const tool = ExternalTool.open(
    'space',
    'notion',
    { title: 'Notion', url: URL_, auth: 'oauth' },
    NOW,
  );
  return {
    ...(tool.unsaved as ExternalToolRow),
    id: '0193a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
    version: 1,
    catalog: [],
    oauth: server,
    oauth_pending: null,
    token: null,
    token_nonce: null,
    token_expires_at: null,
    token_refresh_at: null,
    oauth_error: null,
    ...more,
  };
}

function withToken(
  access: string,
  refresh: string | null,
  expiresAt: Date | null,
): ExternalToolRow {
  const sealed = box.seal(JSON.stringify({ access, refresh }));
  return row({
    token: sealed.ciphertext,
    token_nonce: sealed.nonce,
    token_expires_at: expiresAt,
    token_refresh_at: expiresAt ? later(50 * 60_000) : null,
  });
}

describe('로그인 방식 (ExternalTool, C1)', () => {
  test('OAuth 커넥터는 머리글 · 토큰을 쓰지 않고, 로그인 전에는 붙지 않는다', () => {
    const tool = ExternalTool.open(
      'space',
      'notion',
      { title: 'Notion', url: URL_, auth: 'oauth', header_name: 'Authorization' },
      NOW,
    );
    assert.equal(tool.unsaved.header_name, null);
    assert.equal(tool.ready(NOW), false, '저장 전에도 토큰이 없으면 붙지 않는다');
    assert.equal(ExternalTool.restore(row()).ready(NOW), false, '로그인 전');
    assert.throws(() => tool.edit({ auth: 'basic' }, NOW), RuleViolation);
  });

  test('접근 토큰이 남아 있을 때만 Bearer로 건넨다', () => {
    const tool = ExternalTool.restore(withToken('at-1', 'rt-1', later(3600_000)));
    assert.equal(tool.ready(NOW), true);
    assert.deepEqual(tool.jobView(box).toJSON().headers, { Authorization: 'Bearer at-1' });
    assert.equal(tool.ready(later(3600_000 - 30_000)), false, '곧 끝남');
    assert.equal(ExternalTool.restore(withToken('at', null, null)).ready(NOW), true, '끝을 모름');
  });

  test('주소 · 방식을 바꾸면 로그인을 지운다. 이름표만 바꾸면 둔다', () => {
    const tool = ExternalTool.restore(withToken('at-1', 'rt-1', later(3600_000)));
    tool.edit({ title: '노션' }, NOW);
    assert.equal('token' in tool.unsaved, false);
    tool.edit({ url: 'https://mcp2.example.com/mcp' }, NOW);
    assert.equal(tool.unsaved.token, null);
    assert.deepEqual(tool.unsaved.oauth, {});
    const back = ExternalTool.restore(withToken('at-1', 'rt-1', later(3600_000)));
    back.edit({ auth: 'header', header_name: 'Authorization' }, NOW);
    assert.equal(back.unsaved.token, null);
    assert.equal(back.jobView(box).toJSON().headers.Authorization, undefined, '토큰 넣기 전');
  });

  test('서버 키를 바꾸면 OAuth 토큰도 다시 잠근다', () => {
    const [oldKey, newKey] = [SecretBox.newKey(), SecretBox.newKey()];
    const sealed = SecretBox.fromEnv({ CAIRN_SECRET_KEY: oldKey }).seal(
      JSON.stringify({ access: 'at-1', refresh: 'rt-1' }),
    );
    const tool = ExternalTool.restore(row({ token: sealed.ciphertext, token_nonce: sealed.nonce }));
    const rotated = SecretBox.fromEnv({ CAIRN_SECRET_KEY: newKey, CAIRN_SECRET_KEY_OLD: oldKey });
    assert.equal(tool.reseal(rotated), true);
    const fresh = SecretBox.fromEnv({ CAIRN_SECRET_KEY: newKey });
    assert.deepEqual(tool.jobView(fresh).toJSON().headers, { Authorization: 'Bearer at-1' });
    assert.equal(tool.reseal(rotated), false, '이미 지금 키');
  });
});

describe('로그인의 흐름 (ConnectorLogin)', () => {
  test('state는 한 번만, 같은 커넥터에서 싼 것만 맞는다', () => {
    const login = ConnectorLogin.restore(row({ oauth: {} }));
    const { state, verifier } = OAuthGrant.begin(login.id);
    const pending = box.pack(
      OAuthGrant.purposeOf(login.id),
      OAuthGrant.pending(state, verifier),
      600,
      NOW,
    );
    login.begin(URL_, server, pending);
    assert.throws(
      () => login.begin('https://other.example.com/mcp', server, pending),
      RuleViolation,
    );
    assert.throws(() => login.begin(URL_, { ...server, client_id: null }, pending), RuleViolation);
    const saved = ConnectorLogin.restore(row({ oauth_pending: pending }));
    assert.throws(() => saved.take(box, OAuthGrant.begin(login.id).state, NOW), OAuthStop);
    assert.deepEqual(saved.take(box, state, NOW), { verifier, server });
    assert.equal(saved.unsaved.oauth_pending, null);
    const late = ConnectorLogin.restore(row({ oauth_pending: pending }));
    assert.throws(() => late.take(box, state, later(601_000)), OAuthStop, '10분 지남');
  });

  test('연결은 주소가 그대로일 때만, 갱신은 시작할 때의 토큰이 그대로일 때만 적는다', () => {
    const login = ConnectorLogin.restore(row());
    const sealed = box.seal(JSON.stringify({ access: 'at', refresh: 'rt' }));
    assert.throws(
      () => login.connect('https://other.example.com/mcp', sealed, null, null, NOW),
      (e: unknown) => e instanceof OAuthStop && e.reason === OAuthStop.CHANGED,
    );
    login.connect(URL_, sealed, later(3600_000), later(3000_000), NOW);
    assert.equal(login.unsaved.updated_at, NOW, '확인을 다시 맡긴다');

    const base = withToken('at-1', 'rt-1', later(3600_000));
    const before = ConnectorLogin.restore(base);
    assert.equal(before.refreshToken(box), 'rt-1');
    const relogged = ConnectorLogin.restore(withToken('at-1', 'rt-1', later(3600_000)));
    assert.equal(relogged.refreshed(before, sealed, null, null), false, '다른 쪽이 다시 로그인함');
    const same = ConnectorLogin.restore(base);
    assert.equal(same.refreshed(before, sealed, later(7200_000), later(6600_000)), true);
    assert.equal(same.unsaved.token_expires_at?.toISOString(), later(7200_000).toISOString());
  });

  test('갱신 실패: 거절이면 로그인 필요, 잠깐 실패면 5분 뒤(늦어도 끝날 때) 다시', () => {
    const base = withToken('at-1', 'rt-1', later(3600_000));
    const refused = ConnectorLogin.restore(base);
    assert.equal(
      refused.refreshFailed(
        ConnectorLogin.restore(base),
        new RuleViolation('invalid_grant'),
        true,
        NOW,
      ),
      true,
    );
    assert.equal(refused.unsaved.token, null);
    assert.match(String(refused.unsaved.oauth_error), /invalid_grant/);

    const blip = ConnectorLogin.restore(base);
    blip.refreshFailed(ConnectorLogin.restore(base), new ExternalFailure('HTTP 503'), false, NOW);
    assert.equal('token' in blip.unsaved, false);
    assert.equal(
      blip.unsaved.token_refresh_at?.toISOString(),
      later(OAuthGrant.RETRY_MS).toISOString(),
    );

    const ending = withToken('at-1', 'rt-1', later(30_000));
    const gone = ConnectorLogin.restore(ending);
    gone.refreshFailed(ConnectorLogin.restore(ending), new ExternalFailure('HTTP 503'), false, NOW);
    assert.equal(gone.unsaved.token, null, '곧 끝나는 토큰은 다시 해 보지 않는다');
  });
});
