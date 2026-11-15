import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { Shape } from './shape';

// 사이트 도구의 입출력 형식 (2026-11-16 MCP 2단계): 쓰는 부분만 받고, 값은 첫 틀린 칸을 알려 준다

const QUOTES = {
  type: 'object',
  properties: {
    symbol: { type: 'string', maxLength: 10, description: '종목 코드' },
    days: { type: 'integer' },
  },
  required: ['symbol'],
  additionalProperties: false,
};

const PRICES = {
  type: 'object',
  properties: {
    rows: {
      type: 'array',
      maxItems: 3,
      items: {
        type: 'object',
        properties: { date: { type: 'string' }, close: { type: 'number' } },
        required: ['date', 'close'],
      },
    },
    unit: { type: 'string', enum: ['KRW', 'USD'] },
  },
  required: ['rows'],
};

describe('Shape.schemaProblem', () => {
  test('쓰는 부분만으로 된 형식은 통과', () => {
    assert.equal(Shape.schemaProblem(QUOTES), null);
    assert.equal(Shape.schemaProblem(PRICES), null);
  });

  test('맨 위는 object, 모르는 낱말 · 없는 required · items 없는 array는 거절', () => {
    assert.match(
      String(Shape.schemaProblem({ type: 'array', items: { type: 'string' } })),
      /object/,
    );
    assert.match(String(Shape.schemaProblem({ type: 'object', $ref: '#/x' })), /쓰지 않는 낱말/);
    assert.match(
      String(Shape.schemaProblem({ type: 'object', properties: {}, required: ['a'] })),
      /required/,
    );
    assert.match(
      String(Shape.schemaProblem({ type: 'object', properties: { a: { type: 'array' } } })),
      /items/,
    );
    assert.match(
      String(Shape.schemaProblem({ type: 'object', additionalProperties: { type: 'string' } })),
      /false만/,
    );
  });

  test('너무 깊거나 큰 형식은 거절', () => {
    let deep: Record<string, unknown> = { type: 'string' };
    for (let i = 0; i < 8; i++) deep = { type: 'object', properties: { a: deep } };
    assert.match(String(Shape.schemaProblem(deep)), /깊어요/);
    const wide = {
      type: 'object',
      properties: Object.fromEntries(
        Array.from({ length: 31 }, (_, i) => [`k${i}`, { type: 'string' }]),
      ),
    };
    assert.match(String(Shape.schemaProblem(wide)), /30개/);
  });
});

describe('Shape.valueProblem', () => {
  test('맞는 값은 null', () => {
    assert.equal(Shape.valueProblem(QUOTES, { symbol: '005930', days: 5 }), null);
    assert.equal(
      Shape.valueProblem(PRICES, { rows: [{ date: '2026-11-16', close: 1.5 }], unit: 'KRW' }),
      null,
    );
  });

  test('첫 틀린 칸의 경로를 알려 준다', () => {
    assert.match(String(Shape.valueProblem(QUOTES, {})), /\$\.symbol: 꼭/);
    assert.match(
      String(Shape.valueProblem(QUOTES, { symbol: 'x', days: 1.5 })),
      /\$\.days: integer/,
    );
    assert.match(String(Shape.valueProblem(QUOTES, { symbol: 'x', extra: 1 })), /모르는 칸/);
    assert.match(String(Shape.valueProblem(QUOTES, { symbol: 'x'.repeat(11) })), /10자/);
    assert.match(
      String(Shape.valueProblem(PRICES, { rows: [{ date: 'd', close: 'x' }] })),
      /\$\.rows\[0\]\.close: number/,
    );
    assert.match(
      String(
        Shape.valueProblem(PRICES, { rows: [1, 2, 3, 4].map(() => ({ date: 'd', close: 1 })) }),
      ),
      /3개까지/,
    );
    assert.match(String(Shape.valueProblem(PRICES, { rows: [], unit: 'EUR' })), /정해진 값/);
  });

  test('additionalProperties가 없으면 모르는 칸도 받는다 (답에 덧붙은 칸)', () => {
    assert.equal(Shape.valueProblem(PRICES, { rows: [], note: '덧붙임' }), null);
  });
});
