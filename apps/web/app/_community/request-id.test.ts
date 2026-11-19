import assert from 'node:assert/strict';
import { test } from 'node:test';
import { newRequestId } from './request-id.ts';

test('requestId는 UUID v4 모양이고 매번 다르다', () => {
  const a = newRequestId();
  assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.notEqual(a, newRequestId());
});
