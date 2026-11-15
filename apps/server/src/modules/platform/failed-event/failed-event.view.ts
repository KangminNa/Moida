import type { OutboxRow } from '../platform.tables';

// 멈춘 이벤트의 읽기 모양 (관리자 · 명령줄만, 설정 › 일 › 처리 실패). 웹이 `import type`으로 가져온다.
// 내용(data)은 이벤트가 실은 값 그대로다: 이벤트에는 비밀값 · 원문을 싣지 않는다는 규칙이 있다 (모듈 CLAUDE.md).
// 화면은 그 안의 taskId · approvalId 같은 값을 작업 · 승인 화면으로 잇는다.

/** 멈춘 이벤트 하나 */
export class FailedEventView {
  constructor(private readonly row: Readonly<OutboxRow>) {}

  toJSON() {
    const { v: _version, ...data } = (this.row.payload ?? {}) as Record<string, unknown>;
    return {
      id: this.row.id,
      topic: this.row.topic,
      data,
      attempts: this.row.attempts,
      lastError: this.row.last_error,
      /** 이 이벤트를 남긴 요청의 번호 (서버 · 일꾼 로그에서 같은 번호로 찾는다). 모르면 null */
      traceId: this.row.trace_id,
      createdAt: this.row.created_at.toISOString(),
      /** 멈춘 때. 다시 시도하게 돌린 뒤면 null */
      failedAt: this.row.failed_at?.toISOString() ?? null,
    };
  }
}

/** 멈춘 이벤트 목록 (최근에 멈춘 것부터) */
export class FailedEventListView {
  constructor(private readonly rows: readonly OutboxRow[]) {}

  toJSON() {
    return { items: this.rows.map((r) => new FailedEventView(r).toJSON()) };
  }
}
