import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { LoginInbox, LoginTrust } from './login-inbox';

// 로그인 카드 (2026-11-19): 믿는 출처(관리자의 지시에 적힌 도메인 · 같은 등록 도메인)와
// 값을 메모리에만 두는 곳(그 러너만 한 번 꺼낸다 · 10분이 지나면 버린다)

describe('믿는 출처 (LoginTrust)', () => {
  test('등록 단위의 도메인: 나라 도메인 아래 둘째 단계까지 본다', () => {
    assert.equal(LoginTrust.domainOf('nid.naver.com'), 'naver.com');
    assert.equal(LoginTrust.domainOf('www.shop.co.kr'), 'shop.co.kr');
    assert.equal(LoginTrust.domainOf('accounts.example.com.'), 'example.com');
    assert.equal(LoginTrust.domainOf('127.0.0.1'), '127.0.0.1');
    assert.equal(LoginTrust.domainOf('localhost'), 'localhost');
    assert.equal(LoginTrust.sameDomain('nid.naver.com', 'blog.naver.com'), true);
    assert.equal(LoginTrust.sameDomain('naver.com.evil.example', 'blog.naver.com'), false);
  });

  test('관리자의 지시에 그 도메인이 적혀 있는가 (앞이 글자면 다른 도메인)', () => {
    const text = 'naver.com 블로그에 이번 주 글을 올려 주세요';
    assert.equal(LoginTrust.mentioned(text, 'nid.naver.com'), true);
    assert.equal(LoginTrust.mentioned('https://shop.co.kr/orders 정리', 'www.shop.co.kr'), true);
    assert.equal(LoginTrust.mentioned('gnaver.com에서', 'nid.naver.com'), false);
    assert.equal(LoginTrust.mentioned('네이버 블로그에 올려 주세요', 'nid.naver.com'), false);
    assert.equal(LoginTrust.mentioned('', 'nid.naver.com'), false);
  });
});

describe('값을 두는 곳 (LoginInbox)', () => {
  const t0 = 1_000_000;

  test('넣은 값은 그 러너만 한 번 꺼낸다. 꺼내면 상태만 남고 값은 없다', () => {
    const inbox = new LoginInbox();
    inbox.send('sp', 'site', 'runner', { id: 'me', password: 'pw' }, t0);
    assert.equal(inbox.attempt('sp', 'site', t0)?.status, 'sent');
    assert.equal(inbox.take('sp', 'other', t0), null, '다른 러너');
    assert.equal(inbox.take('other-space', 'runner', t0), null, '다른 공간');
    assert.deepEqual(inbox.take('sp', 'runner', t0), {
      siteId: 'site',
      values: { id: 'me', password: 'pw' },
    });
    assert.equal(inbox.take('sp', 'runner', t0), null, '한 번만');
    assert.equal(inbox.attempt('sp', 'site', t0)?.status, 'filling');
    assert.doesNotMatch(JSON.stringify(inbox.attempt('sp', 'site', t0)), /pw/);
  });

  test('결과는 꺼낸 러너만 남긴다', () => {
    const inbox = new LoginInbox();
    inbox.send('sp', 'site', 'runner', { code: '123456' }, t0);
    inbox.take('sp', 'runner', t0);
    const result = {
      outcome: 'submitted' as const,
      reason: null,
      afterUrl: 'https://a.example/',
      image: null,
    };
    assert.equal(inbox.save('sp', 'site', 'other', result, t0), false);
    assert.equal(inbox.save('sp', 'site', 'runner', result, t0), true);
    assert.equal(inbox.save('sp', 'site', 'runner', result, t0), false, '두 번은 아니다');
    assert.equal(inbox.attempt('sp', 'site', t0)?.afterUrl, 'https://a.example/');
  });

  test('10분 안에 꺼내 가지 않으면 버린다 (expired). 꺼낸 뒤 결과가 없으면 2분 뒤 failed. 끝난 상태도 10분 뒤 지운다', () => {
    const inbox = new LoginInbox();
    inbox.send('sp', 'a', 'runner', { id: 'x', password: 'y' }, t0);
    const late = t0 + LoginInbox.KEEP_MS + 1;
    assert.equal(inbox.take('sp', 'runner', late), null);
    assert.equal(inbox.attempt('sp', 'a', late)?.status, 'expired');
    assert.equal(inbox.attempt('sp', 'a', late + LoginInbox.KEEP_MS + 1), null);

    inbox.send('sp', 'b', 'runner', { id: 'x', password: 'y' }, t0);
    inbox.take('sp', 'runner', t0);
    assert.equal(inbox.attempt('sp', 'b', t0 + 3 * 60_000)?.status, 'failed');
  });

  test('같은 사이트에 다시 넣으면 앞 값을 버린다', () => {
    const inbox = new LoginInbox();
    inbox.send('sp', 'site', 'runner', { id: 'old', password: '1' }, t0);
    inbox.send('sp', 'site', 'runner', { id: 'new', password: '2' }, t0);
    assert.deepEqual(inbox.take('sp', 'runner', t0)?.values, { id: 'new', password: '2' });
    assert.equal(inbox.take('sp', 'runner', t0), null);
  });
});
