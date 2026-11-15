import { Logger } from '@nestjs/common';
import { Actor } from '../base/actor';
import { BaseEntity } from '../base/base-entity';
import type { HttpRequest } from './http-types';

/** 요청 로그 한 줄을 받는 곳. 기본은 서버 로그, 시험은 모아 본다. failed: 5xx · 알 수 없는 끊김 */
export type RequestLogSink = (line: string, failed: boolean) => void;

/** 응답 중 요청 로그가 보는 부분 (Node의 ServerResponse) */
type TracedResponse = {
  statusCode: number;
  writableFinished: boolean;
  setHeader(name: string, value: string): void;
  on(event: 'close', listener: () => void): void;
};

// 요청 번호와 요청 로그 (리팩토링 6단계). HttpSetup이 맨 앞에 건다.
//   번호     요청마다 서버가 새로 짓는다 (UUIDv7). 들어온 X-Request-Id는 믿지 않는다: 로그에 글자를 끼워 넣는 길이 된다
//   머리글   모든 응답에 X-Request-Id. 알 수 없는 오류(500)의 본문 · 러너의 오류 문구에도 실린다
//   로그     응답이 끝나거나 끊길 때 한 줄: 번호 · 메서드 · 경로(쿼리 없이) · 상태 · 걸린 시간 · 요청자 종류 · 한 일(MCP 도구)
//            본문 · 머리글 · 쿠키 · 토큰 · IP는 남기지 않는다 (거부된 접근은 보안 기록에 있다). 건강 확인의 2xx는 남기지 않는다
// biome-ignore lint/complexity/noStaticOnlyClass: 서버와 시험이 같은 요청 번호 · 로그를 쓰게 하는 한 곳
export class RequestTrace {
  static readonly HEADER = 'X-Request-Id';
  private static readonly QUIET = /^\/api\/health(\/|$)/;
  private static readonly PATH_MAX = 200;
  private static readonly logger = new Logger('요청');

  /** 기본 로그: 서버 로그 (5xx는 오류 등급) */
  static readonly serverLog: RequestLogSink = (line, failed) =>
    failed ? RequestTrace.logger.error(line) : RequestTrace.logger.log(line);

  /** Express 미들웨어: 번호를 붙이고, 응답이 끝나면 한 줄 */
  static middleware(sink: RequestLogSink = RequestTrace.serverLog) {
    return (req: HttpRequest, res: TracedResponse, next: () => void): void => {
      const started = Date.now();
      const id = BaseEntity.newId();
      req.requestId = id;
      res.setHeader(RequestTrace.HEADER, id);
      res.on('close', () => RequestTrace.write(sink, req, res, started));
      next();
    };
  }

  /** 이 요청의 번호 (붙기 전이면 '-') */
  static of(req: HttpRequest): string {
    return req.requestId ?? '-';
  }

  /** 이 요청이 한 일을 로그 줄에 덧붙인다 (MCP 도구 이름) */
  static note(req: HttpRequest, what: string): void {
    req.traced = what.slice(0, 80);
  }

  /** 알 수 없는 오류: 스택을 요청 번호와 함께 서버 로그에 (응답에는 번호만) */
  static fail(req: HttpRequest, error: unknown): void {
    const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
    RequestTrace.logger.error(`${RequestTrace.of(req)} 알 수 없는 오류: ${detail}`);
  }

  private static write(
    sink: RequestLogSink,
    req: HttpRequest,
    res: TracedResponse,
    started: number,
  ): void {
    const path = (String(req.originalUrl ?? '').split('?')[0] ?? '').slice(
      0,
      RequestTrace.PATH_MAX,
    );
    const done = res.writableFinished;
    if (done && res.statusCode < 300 && RequestTrace.QUIET.test(path)) return;
    const status = done ? String(res.statusCode) : 'aborted';
    // 요청자를 알아보지 못했으면(쿠키 · 토큰 없음, 없는 경로) 방문자다
    const who = req.actor instanceof Actor ? req.actor.kind : 'visitor';
    const parts = [
      RequestTrace.of(req),
      req.method,
      path,
      status,
      `${Date.now() - started}ms`,
      who,
    ];
    if (req.traced) parts.push(req.traced);
    sink(parts.join(' '), done && res.statusCode >= 500);
  }
}
