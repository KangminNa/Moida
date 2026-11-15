import { type ArgumentsHost, Catch, Injectable, Logger } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import { Actor, SystemActor } from '../base/actor';
import { Database } from '../base/database';
import { DomainError } from '../base/errors';
import { SecurityLogService } from '../security/security-log.service';
import type { HttpRequest } from './http-types';

// 처리 단계별 실패(DomainError)를 REST 응답으로 바꾼다. 상태 코드는 오류 클래스가 정한다.
// DB 시간 제한에 걸린 오류(잠금 대기 · 긴 쿼리)는 Busy(503)로 바꾼다. 트랜잭션 밖의 읽기에서도 나므로 입구에서 한 번 바꾼다.
// 그 밖의 오류(Nest의 HttpException, 우리 버그)는 Nest의 기본 처리에 그대로 넘긴다 (404 · 500).
//
// 거부된 접근(보안 기록 `access.denied`, 2026-11-15): /api · /mcp · /oauth에서 401 · 403 · 429가 나면 남긴다.
// 401은 토큰이나 쿠키를 내민 요청만 (그냥 찾아온 방문자는 남기지 않는다). 모듈이 이미 사건으로 남긴 오류(`recorded`)는 건너뛴다.
// 응답을 늦추지 않게 기다리지 않고, 남기지 못하면 서버 로그에 적는다 (응답은 그대로).
@Catch()
@Injectable()
export class DomainErrorFilter extends BaseExceptionFilter {
  private static readonly DENIED = [401, 403, 429];
  private static readonly WATCHED = /^\/(api|mcp|oauth)(\/|$)/;
  private static readonly PATH_MAX = 200;
  private readonly logger = new Logger('보안 기록');

  constructor(private readonly security: SecurityLogService) {
    super();
  }

  override catch(error: unknown, host: ArgumentsHost): void {
    const known = error instanceof DomainError ? error : Database.busy(error);
    if (!known) {
      super.catch(error, host);
      return;
    }
    const http = host.switchToHttp();
    this.recordDenied(known, http.getRequest<HttpRequest>());
    const response = http.getResponse<{
      status(code: number): { json(body: object): void };
    }>();
    response.status(known.status).json(known.toJSON());
  }

  private recordDenied(error: DomainError, request: HttpRequest | undefined): void {
    if (!request || error.recorded || !DomainErrorFilter.DENIED.includes(error.status)) return;
    const path = String(request.originalUrl ?? '').split('?')[0] ?? '';
    if (!DomainErrorFilter.WATCHED.test(path)) return;
    const credential = request.headers.authorization
      ? 'bearer'
      : request.headers.cookie
        ? 'cookie'
        : null;
    if (error.status === 401 && !credential) return;
    this.security
      .record(new SystemActor(), {
        space_id: request.actor instanceof Actor ? request.actor.spaceId : null,
        kind: 'access.denied',
        ip: request.ip ?? null,
        user_agent: String(request.headers['user-agent'] ?? '') || null,
        detail: {
          method: request.method,
          path: path.slice(0, DomainErrorFilter.PATH_MAX),
          status: error.status,
          code: error.code,
          credential,
        },
      })
      .catch((failure: unknown) =>
        this.logger.error(`거부된 접근을 남기지 못했어요: ${String(failure)}`),
      );
  }
}
