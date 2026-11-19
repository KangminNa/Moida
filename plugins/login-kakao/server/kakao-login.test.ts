import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { RuleViolation } from '../../../apps/server/src/plugin-api';
import { FakeKakao } from './fake-kakao';
import { KakaoLogin } from './kakao-login';
import { KakaoLoginGateway } from './kakao-login.gateway';

// 테스트용 카카오 서버로 로그인 방법의 약속을 확인한다: 보낼 주소에 앱 키 · state · 돌아올 주소가 붙고 동의 항목은 없으며,
// 돌아온 코드로 카카오 회원번호를 알려주고, 취소 · 틀린 코드는 RuleViolation.

let fake: FakeKakao;
const CALLBACK = 'https://community.example.com/api/community/login/kakao/callback';
const loginWith = (secret: string | null) =>
  new KakaoLogin(new KakaoLoginGateway('rest-key-1', secret, fake.url, fake.url));

before(async () => {
  fake = await FakeKakao.start();
});
after(() => fake.close());

describe('login-kakao', () => {
  test('보낼 주소: response_type=code, 앱 키, 돌아올 주소, state를 붙이고 동의 항목은 요청하지 않는다', () => {
    const url = new URL(loginWith(null).start(CALLBACK, 'state-123'));
    assert.equal(`${url.origin}${url.pathname}`, `${fake.url}/oauth/authorize`);
    assert.equal(url.searchParams.get('response_type'), 'code');
    assert.equal(url.searchParams.get('client_id'), 'rest-key-1');
    assert.equal(url.searchParams.get('redirect_uri'), CALLBACK);
    assert.equal(url.searchParams.get('state'), 'state-123');
    assert.equal(url.searchParams.get('scope'), null);
  });

  test('돌아온 코드로 카카오 회원번호를 알려준다. Client secret은 넣었을 때만 보낸다', async () => {
    const identity = await loginWith(null).finish(new Map([['code', 'ok-4242']]), CALLBACK);
    assert.equal(identity.subject, '4242');
    assert.equal(fake.lastTokenForm?.get('redirect_uri'), CALLBACK);
    assert.equal(fake.lastTokenForm?.has('client_secret'), false);
    await loginWith('secret-1').finish(new Map([['code', 'ok-7']]), CALLBACK);
    assert.equal(fake.lastTokenForm?.get('client_secret'), 'secret-1');
  });

  test('취소했거나 코드가 틀리면 RuleViolation', async () => {
    const login = loginWith(null);
    await assert.rejects(
      login.finish(new Map([['error', 'access_denied']]), CALLBACK),
      RuleViolation,
    );
    await assert.rejects(login.finish(new Map([['code', 'bad']]), CALLBACK), RuleViolation);
  });
});
