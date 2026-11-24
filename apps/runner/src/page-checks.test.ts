import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { BrowserStop, BrowserStopProblem } from './browser-stop';
import { PageChecks } from './page-checks';

// 누르기 전 내용 확인 (2026-11-24): browser-stop.json의 check 모양과 화면 글자 맞추기
describe('PageChecks', () => {
  test('check는 글자 목록: 공백을 다듬고 같은 것은 하나로, 없으면 빈 목록', () => {
    assert.deepEqual(PageChecks.of(undefined), []);
    assert.deepEqual(PageChecks.of([' 홍길동 ', '50,000\n원', '홍길동']), ['홍길동', '50,000 원']);
    assert.match(String(PageChecks.of('홍길동')), /글자 목록/);
    assert.match(String(PageChecks.of(['a', 'b', 'c', 'd', 'e', 'f'])), /5개까지/);
    assert.match(String(PageChecks.of(['', 'a'])), /1~100자/);
    assert.match(String(PageChecks.of([1])), /1~100자/);
    assert.match(String(PageChecks.of(['x'.repeat(101)])), /1~100자/);
  });

  test('화면에 없는 글자만 고른다 (공백 · 대소문자 무시)', () => {
    const screen = '받는 사람\n  홍길동\n금액 50,000원\nOrder #A12';
    assert.deepEqual(PageChecks.missing(screen, ['홍길동', '50,000원', 'order #a12']), []);
    assert.deepEqual(PageChecks.missing(screen, ['김철수', '50,000원', '5,000원']), [
      '김철수',
      '5,000원',
    ]);
    // 숫자는 숫자의 가운데와 맞추지 않는다
    assert.deepEqual(
      PageChecks.missing('합계 15,000원 · 1.5kg · 수량 100', ['5,000원', '5kg', '10']),
      ['5,000원', '5kg', '10'],
    );
    assert.deepEqual(PageChecks.missing('합계 ₩5,000 (수량 10개)', ['5,000', '10개', '(수량']), []);
    assert.equal(PageChecks.problem(['김철수']), '화면에 없는 내용: "김철수"');
  });

  test('browser-stop.json: final_click의 check를 읽고, 틀린 모양이면 멈춘 자리를 읽지 않는다', () => {
    const base = {
      stop: 'final_click',
      page_url: 'https://shop.example/pay',
      button: { role: 'button', name: '결제' },
    };
    assert.deepEqual(BrowserStop.of(base).checks, []);
    assert.deepEqual(BrowserStop.of({ ...base, check: ['홍길동', '50,000원'] }).checks, [
      '홍길동',
      '50,000원',
    ]);
    assert.throws(() => BrowserStop.of({ ...base, check: '홍길동' }), BrowserStopProblem);
  });
});
