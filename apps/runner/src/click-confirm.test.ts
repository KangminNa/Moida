import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ClickConfirm } from './click-confirm';

// 누른 뒤 확인 (L3): 인증 화면 · 결과의 번호를 화면 글에서 고르고, 서버에는 상태 · 번호 · 제목만 보낸다

test('결과 화면이면 예약 · 주문 번호를 고르고, 번호가 없으면 상태만', () => {
  const done = ClickConfirm.of(
    '예약 완료 | 식당',
    '예약이 완료되었습니다.\n예약번호: RS-20261128-77\n홍길동 님',
  );
  assert.deepEqual(done.toJSON(), {
    state: 'done',
    reference: 'RS-20261128-77',
    title: '예약 완료 | 식당',
  });
  assert.equal(ClickConfirm.of('Order placed', 'Thanks! Order #A1B2C3D4').reference, 'A1B2C3D4');
  assert.deepEqual(ClickConfirm.of('', '감사합니다').toJSON(), { state: 'done' });
  assert.equal(
    JSON.stringify(done.toJSON()).includes('홍길동'),
    false,
    '화면의 글은 보내지 않는다',
  );
});

test('결제 · 본인 인증 화면이면 auth (번호보다 먼저)', () => {
  const auth = ClickConfirm.of('결제', '휴대폰 본인인증을 진행해 주세요. 주문번호 X12345');
  assert.equal(auth.state, 'auth');
  assert.equal(auth.reference, null);
  assert.equal(ClickConfirm.of('Verify', 'Enter the verification code we sent').state, 'auth');
  assert.equal(ClickConfirm.of('3D Secure', '').state, 'auth');
});
