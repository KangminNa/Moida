import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { Forbidden, RuleViolation, SecretBox } from '../../platform';
import { JoinTicket } from './join-ticket';
import { Member } from './member';
import { MemberCsrf } from './member-csrf.policy';
import { Nickname } from './nickname.policy';

// 회원 규칙 (스토어 3-1a): 닉네임 · 가입 · 닉네임 바꾸기 간격 · 차단, 가입 표와 쓰기 확인 값.

const NOW = new Date('2026-11-19T00:00:00Z');
const DAY = 86_400_000;
const box = SecretBox.fromEnv({ CAIRN_SECRET_KEY: SecretBox.newKey() });

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
  test('가입: 만 14세 확인이 있어야 하고, 로그인 하나와 첫 세션을 함께 만든다', () => {
    assert.throws(() => Member.join('a1', '마을사람', false, 'kakao', '1', NOW), /만 14세/);
    const member = Member.join('a1', '마을사람', true, 'kakao', '1', NOW);
    assert.deepEqual(
      [member.addedLogin?.method, member.addedLogin?.subject, member.addedLogin?.app_id],
      ['kakao', '1', 'a1'],
    );
    assert.equal(typeof member.startedSession?.token, 'string');
    const view = member.view().toJSON() as Record<string, unknown>;
    assert.equal(view.writableAt, new Date(NOW.getTime() + Member.JOIN_WAIT_MS).toISOString());
  });

  test('닉네임은 처음엔 바로, 그 뒤로는 7일에 한 번', () => {
    const member = Member.join('a1', '처음이름', true, 'kakao', '2', NOW);
    member.rename('두번째', new Date(NOW.getTime() + DAY));
    assert.throws(() => member.rename('세번째', new Date(NOW.getTime() + 3 * DAY)), /7일에 한 번/);
    member.rename('세번째', new Date(NOW.getTime() + 9 * DAY));
  });

  test('차단 중이면 403, 무기한이면 날짜 없이', () => {
    const blocked = Member.restore({
      id: 'm1',
      app_id: 'a1',
      nickname: '차단됨',
      nickname_key: '차단됨',
      age_confirmed_at: NOW,
      blocked_until: new Date(NOW.getTime() + DAY),
      block_note: null,
      joined_at: NOW,
      renamed_at: null,
      last_seen_at: null,
      version: 1,
    });
    assert.throws(
      () => blocked.assertActive(NOW),
      (e: unknown) => e instanceof Forbidden && /까지/.test(e.message),
    );
    blocked.assertActive(new Date(NOW.getTime() + 2 * DAY));
  });
});

describe('JoinTicket · MemberCsrf', () => {
  test('가입 표는 그 앱에서만 풀린다', () => {
    const ticket = JoinTicket.issue(box, 'a1', 'kakao', '42', '/p/1');
    assert.equal(JoinTicket.open(box, ticket.cookie, 'a1')?.subject, '42');
    assert.equal(JoinTicket.open(box, ticket.cookie, 'a2'), null);
    assert.equal(JoinTicket.open(box, null, 'a1'), null);
    assert.equal(JoinTicket.open(box, `${ticket.cookie}x`, 'a1'), null);
  });

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
