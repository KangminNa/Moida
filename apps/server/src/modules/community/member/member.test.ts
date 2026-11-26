import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { Forbidden, RuleViolation, SecretBox } from '../../platform';
import type { MemberRow } from '../community.tables';
import { Member } from './member';
import { MemberCsrf } from './member-csrf.policy';
import { MemberPassword } from './member-password.policy';
import { Nickname } from './nickname.policy';

// 회원 규칙 (스토어 3-1, 메일 인증 가입 2026-11-26): 비밀번호 · 닉네임, 가입 · 닉네임 바꾸기 간격 · 차단 · 비밀번호 바꾸기, 쓰기 확인 값.

const NOW = new Date('2026-11-19T00:00:00Z');
const DAY = 86_400_000;
const box = SecretBox.fromEnv({ CAIRN_SECRET_KEY: SecretBox.newKey() });

function row(more: Partial<MemberRow> = {}): MemberRow {
  return {
    id: 'm1',
    app_id: 'a1',
    account_id: 'acc1',
    nickname: '마을사람',
    nickname_key: '마을사람',
    age_confirmed_at: NOW,
    blocked_until: null,
    block_note: null,
    joined_at: NOW,
    renamed_at: null,
    last_seen_at: null,
    version: 1,
    terms_version: 1,
    privacy_version: 1,
    left_at: null,
    ...more,
  };
}

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
      'Moida팀',
    ])
      assert.throws(() => Nickname.clean(bad), RuleViolation, bad);
    assert.equal(Nickname.clean('badminton'), 'badminton');
  });
});

describe('Member', () => {
  test('앱 참여: 계정의 만 14세 확인을 옮겨 적고, 가입 대기가 끝나는 때를 보인다', () => {
    const member = Member.enter('a1', 'acc1', '마을사람', NOW, NOW);
    assert.equal(member.accountId, 'acc1');
    const view = member.view().toJSON() as Record<string, unknown>;
    assert.equal('email' in view || 'loginId' in view, false);
    assert.equal(view.writableAt, new Date(NOW.getTime() + Member.JOIN_WAIT_MS).toISOString());
  });

  test('닉네임은 처음엔 바로, 그 뒤로는 7일에 한 번', () => {
    const member = Member.enter('a1', 'acc1', '처음이름', NOW, NOW);
    member.rename('두번째', new Date(NOW.getTime() + DAY));
    assert.throws(() => member.rename('세번째', new Date(NOW.getTime() + 3 * DAY)), /7일에 한 번/);
    member.rename('세번째', new Date(NOW.getTime() + 9 * DAY));
  });

  test('앱에서 나가면 계정 연결과 닉네임을 지우고, 두 번은 409', () => {
    const member = Member.restore(row());
    member.leave(NOW);
    assert.equal(member.accountId, null);
    assert.equal(member.nickname, Member.LEFT_NAME);
    assert.throws(() => member.leave(NOW), /이미 나간/);
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
