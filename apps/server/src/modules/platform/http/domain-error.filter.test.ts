import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { ArgumentsHost } from '@nestjs/common';
import { OwnerActor } from '../base/actor';
import { Forbidden, NotFound, TooManyRequests, Unauthenticated } from '../base/errors';
import type { SecurityNew } from '../security/security-log';
import type { SecurityLogService } from '../security/security-log.service';
import { DomainErrorFilter } from './domain-error.filter';

// 거부된 접근의 보안 기록 (2026-11-15): 무엇을 남기고 무엇을 건너뛰는지. DB 없이 돈다
describe('오류 필터: 거부된 접근 기록', () => {
  function run(error: Error, request: Record<string, unknown>) {
    const recorded: SecurityNew[] = [];
    const statuses: number[] = [];
    const filter = new DomainErrorFilter({
      record: async (_actor: unknown, event: SecurityNew) => {
        recorded.push(event);
      },
    } as unknown as SecurityLogService);
    const host = {
      switchToHttp: () => ({
        getRequest: () => ({
          method: 'GET',
          headers: {},
          query: {},
          protocol: 'https',
          ...request,
        }),
        getResponse: () => ({
          status: (status: number) => ({ json: () => statuses.push(status) }),
        }),
      }),
    } as unknown as ArgumentsHost;
    filter.catch(error, host);
    return { recorded, statuses };
  }

  test('토큰을 내민 401은 남긴다. 경로의 쿼리 · 토큰 값은 남기지 않는다', () => {
    const { recorded, statuses } = run(new Unauthenticated('다시 연결해 주세요'), {
      method: 'POST',
      originalUrl: '/mcp?session=abc',
      headers: { authorization: 'Bearer secret-token', 'user-agent': 'curl/8' },
      ip: '203.0.113.7',
    });
    assert.deepEqual(statuses, [401], '응답은 그대로');
    assert.equal(recorded.length, 1);
    assert.deepEqual(recorded[0], {
      space_id: null,
      kind: 'access.denied',
      ip: '203.0.113.7',
      user_agent: 'curl/8',
      detail: {
        method: 'POST',
        path: '/mcp',
        status: 401,
        code: 'unauthenticated',
        credential: 'bearer',
      },
    });
    assert.ok(!JSON.stringify(recorded).includes('secret-token'), '토큰 값은 없다');
  });

  test('아무것도 내밀지 않은 401, 지켜보지 않는 경로, 거부가 아닌 오류는 남기지 않는다', () => {
    assert.equal(
      run(new Unauthenticated('로그인해 주세요'), { originalUrl: '/api/auth/me' }).recorded.length,
      0,
    );
    assert.equal(
      run(new Forbidden('owner'), { originalUrl: '/pages/x', headers: { cookie: 'a=b' } }).recorded
        .length,
      0,
    );
    assert.equal(
      run(new NotFound('없어요'), { originalUrl: '/api/x', headers: { cookie: 'a=b' } }).recorded
        .length,
      0,
    );
  });

  test('403 · 429는 내민 것이 없어도 남기고, 요청자의 공간을 적는다', () => {
    const forbidden = run(new Forbidden('origin'), {
      originalUrl: '/api/agents',
      headers: { cookie: 'cairn_session=x' },
      actor: new OwnerActor('space-1', 'user-1'),
    });
    assert.equal(forbidden.recorded[0]?.space_id, 'space-1');
    assert.equal(forbidden.recorded[0]?.detail?.credential, 'cookie');
    assert.equal(
      run(new TooManyRequests('잠시 뒤에'), { originalUrl: '/oauth/register' }).recorded.length,
      1,
    );
  });

  test('모듈이 이미 사건으로 남긴 오류는 다시 남기지 않는다', () => {
    const error = new Unauthenticated('아이디나 비밀번호가 맞지 않아요').markRecorded();
    const { recorded, statuses } = run(error, {
      originalUrl: '/api/auth/login',
      headers: { cookie: 'a=b' },
    });
    assert.equal(recorded.length, 0);
    assert.deepEqual(statuses, [401]);
  });
});
