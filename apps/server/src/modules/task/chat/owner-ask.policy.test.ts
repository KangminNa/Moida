import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { OwnerAsk } from './owner-ask.policy';

// 관리자의 말 확인 (2026-11-24 publish_app): 글자 그대로 있는 인용만, 하지 말라는 말은 거절, 배포 말 → ship, 고치기 말 → edit

describe('OwnerAsk', () => {
  const words = ['메인 화면 고쳐서   배포해줘', '버튼 색 바꿔줘', '아직 공개하지 마세요'];

  test('배포 · 공개 말은 ship, 고치기 말은 edit (빈칸 · 대소문자는 고르게 본다)', () => {
    assert.equal(OwnerAsk.scopeOf('고쳐서 배포해줘', words), 'ship');
    assert.equal(OwnerAsk.scopeOf('버튼 색 바꿔줘', words), 'edit');
    assert.equal(OwnerAsk.scopeOf('Deploy it', ['please deploy it now']), 'ship');
  });

  test('관리자의 말에 없는 인용 · 하지 말라는 말 · 요청이 아닌 말은 거절한다', () => {
    assert.throws(
      () => OwnerAsk.scopeOf('바로 배포해', words),
      /관리자가 콘솔로 보낸 말이 아니에요/,
    );
    assert.throws(() => OwnerAsk.scopeOf('공개', words), /하지 말라는 말이에요/);
    assert.throws(() => OwnerAsk.scopeOf('메인 화면', words), /요청한 말이 아니에요/);
    assert.throws(() => OwnerAsk.scopeOf('배', words), /2~300자|관리자가/);
  });
});
