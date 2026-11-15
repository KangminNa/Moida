import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { repeatKey } from './repeats';

// 되풀이되는 일의 열쇠 (2026-11-16 MCP 3단계): 숫자 · 날짜 · 따옴표 안 글자 · 대소문자 · 공백이 달라도 같은 일

describe('repeatKey', () => {
  test('종목 코드 · 날짜 · 따옴표 안 값만 다른 지시는 같은 열쇠', () => {
    const a = repeatKey('005930 오늘 종가 알려줘');
    assert.equal(repeatKey('000660  오늘 종가 알려줘'), a);
    assert.equal(
      repeatKey('2026-11-16 기준 "삼성전자" 공시 목록'),
      repeatKey('2026-11-17 기준 "카카오" 공시 목록'),
    );
    assert.equal(repeatKey('Weekly REPORT 3'), repeatKey('weekly report 12'));
  });

  test('하는 일이 다르면 다른 열쇠, 모양은 sha256', () => {
    assert.notEqual(repeatKey('005930 종가 알려줘'), repeatKey('005930 공시 알려줘'));
    assert.match(repeatKey('아무 일'), /^[0-9a-f]{64}$/);
  });
});
