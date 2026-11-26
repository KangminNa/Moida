import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { Forbidden, InvalidRequest } from '../../platform';
import type { AccountRow } from '../community.tables';
import { Account } from './account';
import { LoginId } from './login-id.policy';

// 스토어 계정 규칙 (2026-11-26): 가입 · 아이디 · 비밀번호 바꾸기 · 정지 · 탈퇴 · 옛 계정의 빈 칸 채우기

const NOW = new Date('2026-11-26T00:00:00Z');
const DAY = 86_400_000;
const HASH = 'scrypt$15$8$1$c2FsdA==$aGFzaA==';

function row(more: Partial<AccountRow> = {}): AccountRow {
  return {
    id: 'acc1',
    space_id: 's1',
    login_id: 'villager',
    email: 'v@example.com',
    password_hash: HASH,
    password_changed_at: NOW,
    age_confirmed_at: NOW,
    terms_version: 1,
    privacy_version: 1,
    suspended_until: null,
    joined_at: NOW,
    last_seen_at: null,
    left_at: null,
    version: 1,
    ...more,
  };
}

describe('LoginId', () => {
  test('영문 소문자로 시작하는 4~20자, 소문자로 정리한다', () => {
    assert.equal(LoginId.clean('  Villager_1 '), 'villager_1');
    for (const bad of ['abc', '1abc', 'a'.repeat(21), '한글아이디', 'ab-cd'])
      assert.throws(() => LoginId.clean(bad), InvalidRequest, bad);
  });

  test('운영자 · 서비스로 보이는 아이디는 막는다', () => {
    for (const bad of ['admin', 'moida', 'cairn', 'support'])
      assert.throws(
        () => LoginId.clean(bad),
        (e: unknown) =>
          e instanceof InvalidRequest && /쓸 수 없는/.test(e.fields.get('loginId') ?? ''),
        bad,
      );
  });
});

describe('Account', () => {
  test('가입: 만 14세 확인이 있어야 하고, 가입한 앱에 첫 로그인을 연다', () => {
    assert.throws(
      () => Account.join('s1', 'a1', 'v@example.com', 'villager', HASH, false, NOW),
      /만 14세/,
    );
    const account = Account.join('s1', 'a1', 'v@example.com', 'villager', HASH, true, NOW);
    assert.equal(account.startedSession?.isNew, true);
    assert.equal(typeof account.startedSession?.token, 'string');
    assert.equal(account.agreed, false);
    account.agree(1, 1);
    assert.equal(account.agreed, true);
    const view = account.view().toJSON();
    assert.equal(JSON.stringify(view).includes('scrypt'), false);
    assert.deepEqual(view.needs, []);
  });

  test('비밀번호를 바꾸면 지금 로그인만 남기고, 다시 정하면 모두 끝낸다', () => {
    const changed = Account.restore(row());
    changed.changePassword('scrypt$new', 'keep-hash', NOW);
    assert.equal(changed.passwordHash, 'scrypt$new');
    assert.equal(changed.endsSessions, true);
    assert.equal(changed.sessionToKeep, 'keep-hash');
    const reset = Account.restore(row());
    reset.resetPassword('scrypt$new', NOW);
    assert.equal(reset.endsSessions, true);
    assert.equal(reset.sessionToKeep, null);
  });

  test('정지 중이면 로그인이 403, 정지는 로그인을 끝내고, 풀면 된다', () => {
    const account = Account.restore(row());
    account.suspend(new Date(NOW.getTime() + DAY), NOW);
    assert.equal(account.endsSessions, true);
    assert.throws(
      () => account.startSession('a1', NOW),
      (e: unknown) => e instanceof Forbidden && /까지/.test(e.message),
    );
    account.unsuspend(NOW);
    account.startSession('a1', NOW);
    assert.throws(() => account.unsuspend(NOW), /정지된 계정이 아니에요/);
    assert.throws(() => account.suspend(new Date(NOW.getTime() - DAY), NOW), /지금보다 뒤/);
  });

  test('옛 계정은 빈 아이디 · 메일만 한 번 채운다', () => {
    const oldMail = Account.restore(row({ login_id: null }));
    assert.deepEqual(oldMail.view().needs, ['loginId']);
    assert.equal(oldMail.loginName, 'v@example.com');
    assert.deepEqual(oldMail.passwordNames, ['v']);
    oldMail.setLoginId('villager');
    assert.throws(() => oldMail.setLoginId('other_id'), /이미 정했어요/);
    const oldId = Account.restore(row({ email: null, terms_version: null }));
    assert.deepEqual(oldId.view().needs, ['email', 'terms']);
    oldId.setEmail('v@example.com');
    assert.throws(() => oldId.setEmail('w@example.com'), /이미 등록했어요/);
  });

  test('탈퇴하면 메일 · 아이디 · 해시를 지우고 모든 로그인을 끝낸다', () => {
    const account = Account.restore(row());
    account.leave(NOW);
    const view = account.view().toJSON();
    assert.equal(view.email, null);
    assert.equal(view.loginId, null);
    assert.equal(account.passwordHash, '');
    assert.equal(account.endsSessions, true);
    assert.throws(() => account.leave(NOW), /이미 탈퇴한/);
  });
});
