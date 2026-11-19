import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { Forbidden, RuleViolation, SecretBox } from '../../platform';
import type { MemberRow } from '../community.tables';
import { LoginId } from './login-id.policy';
import { Member } from './member';
import { MemberCsrf } from './member-csrf.policy';
import { MemberPassword } from './member-password.policy';
import { Nickname } from './nickname.policy';

// 회원 규칙 (스토어 3-1, 아이디 · 비밀번호 가입): 아이디 · 비밀번호 · 닉네임, 가입 · 닉네임 바꾸기 간격 · 차단 · 비밀번호 바꾸기, 쓰기 확인 값.

const NOW = new Date('2026-11-19T00:00:00Z');
const DAY = 86_400_000;
const HASH = 'scrypt$15$8$1$c2FsdA==$aGFzaA==';
const box = SecretBox.fromEnv({ CAIRN_SECRET_KEY: SecretBox.newKey() });

function row(more: Partial<MemberRow> = {}): MemberRow {
  return {
    id: 'm1',
    app_id: 'a1',
    login_id: 'villager',
    password_hash: HASH,
    password_changed_at: NOW,
    nickname: '마을사람',
    nickname_key: '마을사람',
    age_confirmed_at: NOW,
    blocked_until: null,
    block_note: null,
    joined_at: NOW,
    renamed_at: null,
    last_seen_at: null,
    version: 1,
    ...more,
  };
}

describe('LoginId', () => {
  test('앞뒤 공백을 빼고 소문자로 둔다', () => {
    assert.equal(LoginId.clean('  Villager_01 '), 'villager_01');
  });

  test('영문 소문자로 시작하는 4~20자 (영문 · 숫자 · _)만, 운영자로 보이는 아이디는 받지 않는다', () => {
    for (const bad of [
      'abc',
      'a'.repeat(21),
      '1villager',
      'vil-lager',
      '마을사람',
      'admin2',
      'cairn_team',
      'Support',
    ])
      assert.throws(() => LoginId.clean(bad), RuleViolation, bad);
  });
});

describe('MemberPassword', () => {
  test('10~200자, 조합 규칙은 없다 (긴 문장도 된다)', () => {
    MemberPassword.check('오늘은 비가 와서 집에 있다', 'villager', '마을사람');
    assert.throws(() => MemberPassword.check('short123', 'villager', '마을사람'), /10자 이상/);
    assert.throws(
      () => MemberPassword.check('x'.repeat(201), 'villager', '마을사람'),
      /200자 이하/,
    );
  });

  test('아이디 · 닉네임과 같은 값, 한 글자 되풀이, 흔한 값은 받지 않는다', () => {
    assert.throws(
      () => MemberPassword.check('villager_long', 'villager_long', '닉'),
      /아이디 · 닉네임/,
    );
    assert.throws(
      () => MemberPassword.check('긴닉네임입니다요요요', 'villager', '긴닉네임입니다요요요'),
      /아이디 · 닉네임/,
    );
    assert.throws(() => MemberPassword.check('aaaaaaaaaaaa', 'villager', '마을사람'), /너무 쉬운/);
    assert.throws(() => MemberPassword.check('1q2w3e4r5t', 'villager', '마을사람'), /너무 쉬운/);
  });
});

describe('Nickname', () => {
  test('앞뒤 · 겹친 공백을 정리하고, 겹침은 소문자 · 공백 · 구두점 없이 비교한다', () => {
    assert.equal(Nickname.clean('  마을   사람 '), '마을 사람');
    assert.equal(Nickname.keyOf('Kim Lee'), Nickname.keyOf('kim.lee'));
    assert.equal(Nickname.keyOf('ＡＢＣ'), 'abc');
  });

  test('길이 · 모양 · 운영자로 보이는 이름은 받지 않는다 (badminton은 된다)', () => {
    for (const bad of [
      'a',
      'x'.repeat(21),
      '<script>',
      '공식계정',
      '운영자김',
      'admin1',
      'Cairn팀',
    ])
      assert.throws(() => Nickname.clean(bad), RuleViolation, bad);
    assert.equal(Nickname.clean('badminton'), 'badminton');
  });
});

describe('Member', () => {
  test('가입: 만 14세 확인이 있어야 하고, 첫 로그인을 함께 연다', () => {
    assert.throws(() => Member.join('a1', 'villager', HASH, '마을사람', false, NOW), /만 14세/);
    const member = Member.join('a1', 'villager', HASH, '마을사람', true, NOW);
    assert.equal(typeof member.startedSession?.token, 'string');
    const view = member.view().toJSON() as Record<string, unknown>;
    assert.equal(view.loginId, 'villager');
    assert.equal('passwordHash' in view || JSON.stringify(view).includes('scrypt'), false);
    assert.equal(view.writableAt, new Date(NOW.getTime() + Member.JOIN_WAIT_MS).toISOString());
  });

  test('닉네임은 처음엔 바로, 그 뒤로는 7일에 한 번', () => {
    const member = Member.join('a1', 'villager', HASH, '처음이름', true, NOW);
    member.rename('두번째', new Date(NOW.getTime() + DAY));
    assert.throws(() => member.rename('세번째', new Date(NOW.getTime() + 3 * DAY)), /7일에 한 번/);
    member.rename('세번째', new Date(NOW.getTime() + 9 * DAY));
  });

  test('비밀번호를 바꾸면 지금 로그인만 남길 세션으로 적는다', () => {
    const member = Member.restore(row());
    assert.equal(member.sessionToKeep, null);
    member.changePassword('scrypt$new', 'keep-hash', NOW);
    assert.equal(member.passwordHash, 'scrypt$new');
    assert.equal(member.sessionToKeep, 'keep-hash');
  });

  test('차단 중이면 403 (날짜와 함께), 지나면 된다', () => {
    const blocked = Member.restore(row({ blocked_until: new Date(NOW.getTime() + DAY) }));
    assert.throws(
      () => blocked.assertActive(NOW),
      (e: unknown) => e instanceof Forbidden && /까지/.test(e.message),
    );
    blocked.assertActive(new Date(NOW.getTime() + 2 * DAY));
    const forever = Member.restore(row({ blocked_until: Member.FOREVER }));
    assert.throws(
      () => forever.assertActive(NOW),
      (e: unknown) => e instanceof Forbidden && !/까지/.test(e.message),
    );
  });
});

describe('MemberCsrf', () => {
  test('확인 값은 쿠키마다 다르고 서버 키 없이는 만들 수 없다', () => {
    const csrf = new MemberCsrf(box);
    const token = csrf.tokenOf('cookie-1');
    assert.equal(csrf.matches('cookie-1', token), true);
    assert.equal(csrf.matches('cookie-2', token), false);
    assert.equal(csrf.matches('cookie-1', undefined), false);
    const other = new MemberCsrf(SecretBox.fromEnv({ CAIRN_SECRET_KEY: SecretBox.newKey() }));
    assert.equal(other.matches('cookie-1', token), false);
  });
});
