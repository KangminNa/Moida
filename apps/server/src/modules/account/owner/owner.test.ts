import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { RuleViolation } from '../../platform';
import type { WebSessionRow } from '../account.tables';
import { type LoadedOwner, Owner, WebSession } from './owner';

// 로그인의 사건(보안 기록 · 알림)과 보안 화면의 끝내기 규칙 (2026-11-15). DB 없이 돈다
const NOW = new Date('2026-11-15T09:00:00Z');
const ROW = {
  id: 'user-1',
  login: 'owner',
  password_hash: 'hash',
  password_changed_at: NOW,
  display_name: null,
  version: 1,
  created_at: NOW,
  space_id: 'space-1',
} as unknown as LoadedOwner;

function sessionRow(id: string, token: string, ended = false): WebSessionRow {
  return {
    id,
    user_id: 'user-1',
    token_hash: WebSession.hash(token),
    ip: '203.0.113.7',
    user_agent: 'browser',
    created_at: NOW,
    expires_at: new Date(NOW.getTime() + 86_400_000),
    revoked_at: ended ? NOW : null,
    last_seen_at: null,
    last_ip: null,
  };
}

describe('로그인 사건', () => {
  test('최근 로그인한 곳과 다른 곳이면 newPlace. 같은 IPv6 /64는 같은 곳, 설치 때는 보지 않는다', () => {
    const owner = Owner.restore(ROW);
    owner.startSession('2001:db8:1:2::9', 'b', NOW, 'password', ['2001:db8:1:2::1']);
    owner.startSession('198.51.100.1', 'b', NOW, 'password', ['203.0.113.7']);
    owner.startSession('198.51.100.2', 'b', NOW, 'install');
    const events = owner.pullEvents();
    assert.deepEqual(
      events.map((e) => [e.name, e.data.newPlace, e.data.method]),
      [
        ['account.login.succeeded', false, 'password'],
        ['account.login.succeeded', true, 'password'],
        ['account.login.succeeded', false, 'install'],
      ],
    );
    assert.ok(events.every((e) => typeof e.data.sessionId === 'string'));
    assert.ok(!JSON.stringify(events.map((e) => e.data)).includes('hash'), '해시 없음');
  });

  test('로그아웃은 한 번만 사건이 된다', () => {
    const owner = Owner.restore(ROW, [WebSession.restore(sessionRow('s1', 'tok'))]);
    owner.endSession(WebSession.hash('tok'), NOW);
    owner.endSession(WebSession.hash('tok'), NOW);
    assert.deepEqual(
      owner.pullEvents().map((e) => [e.name, e.data.how]),
      [['account.session.ended', 'logout']],
    );
  });
});

describe('보안 화면의 끝내기', () => {
  test('다른 로그인 하나를 끝낸다. 이미 끝났으면 그대로, 지금 로그인과 없는 로그인은 RuleViolation', () => {
    const owner = Owner.restore(ROW, [
      WebSession.restore(sessionRow('other', 'other-token')),
      WebSession.restore(sessionRow('done', 'done-token', true)),
      WebSession.restore(sessionRow('mine', 'my-token')),
    ]);
    const mine = WebSession.hash('my-token');
    owner.endSessionById('other', mine, NOW);
    owner.endSessionById('done', mine, NOW);
    assert.throws(() => owner.endSessionById('mine', mine, NOW), RuleViolation);
    assert.throws(() => owner.endSessionById('nope', mine, NOW), RuleViolation);
    assert.deepEqual(
      owner.changedSessions.map((s) => s.id),
      ['other'],
    );
    assert.deepEqual(
      owner.pullEvents().map((e) => [e.name, e.data.how]),
      [['account.session.ended', 'ended']],
    );
  });

  test('다른 곳 모두 로그아웃은 지금 로그인을 남긴다', () => {
    const current = WebSession.restore(sessionRow('mine', 'my-token'));
    const owner = Owner.restore(ROW, [current]);
    owner.endOtherSessions(current);
    assert.equal(owner.endsOtherSessions, true);
    assert.equal(owner.keptSessionId, 'mine');
  });
});
