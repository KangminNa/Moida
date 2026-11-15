import { BaseRequest } from '../base/base-request';

/**
 * 보안 기록 읽기 (GET /api/security/events?group=&cursor=).
 * group: 종류의 앞 마디 하나 (login · session · password · install · device · runner · access). 없으면 모두.
 * cursor: 앞 쪽 응답의 next 그대로 (그보다 앞선 것부터)
 */
export class SecurityEventsInput extends BaseRequest {
  static readonly PAGE = 50;
  private static readonly GROUP = /^[a-z]{1,20}$/;
  private static readonly CURSOR = /^(\d{4}-\d{2}-\d{2}T[\d:.]+Z)\|([0-9a-f-]{36})$/;

  private constructor(
    readonly group: string | null,
    /** 이 시각 · id보다 앞선 것부터 */
    readonly before: readonly [Date, string] | null,
  ) {
    super();
  }

  static from(query: unknown): SecurityEventsInput {
    return BaseRequest.read(query, (f) => {
      const group = f.optionalText('group', 20);
      if (group && !SecurityEventsInput.GROUP.test(group))
        f.reject('group', '영문 소문자 한 마디예요 (예: login)');
      const cursor = f.optionalText('cursor', 200);
      const match = SecurityEventsInput.CURSOR.exec(
        cursor ? Buffer.from(cursor, 'base64url').toString() : '',
      );
      if (cursor && !match) f.reject('cursor', '앞 쪽 응답의 next 값을 그대로 보내 주세요');
      return new SecurityEventsInput(
        group || null,
        match?.[1] && match[2] ? [new Date(match[1]), match[2]] : null,
      );
    });
  }

  /** 다음 쪽을 부를 값: 이 쪽의 마지막 줄 */
  static cursorAfter(at: Date, id: string): string {
    return Buffer.from(`${at.toISOString()}|${id}`).toString('base64url');
  }
}
