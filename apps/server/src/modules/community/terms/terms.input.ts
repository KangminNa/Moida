import { BaseRequest, ValueList } from '../../platform';
import { TERM_KIND, type TermKind } from '../community.tables';

/** 약관 종류 (주소의 :kind). terms · privacy가 아니면 422 */
export class TermKindInput extends BaseRequest {
  private constructor(readonly kind: TermKind) {
    super();
  }

  static from(raw: string): TermKindInput {
    return BaseRequest.read({ kind: raw }, (f) => {
      const kind = f.text('kind', 20);
      if (!ValueList.has(TERM_KIND, kind))
        f.reject('kind', '약관은 terms · privacy 가운데 하나예요');
      return new TermKindInput(kind as TermKind);
    });
  }
}

/**
 * 약관의 새 버전 올리기 (관리자): { version, body }. version은 화면이 본 지금 버전(처음이면 0)이고, 그사이 바뀌었으면 409.
 * 본문 길이는 도메인(Term.publish)이 본다
 */
export class TermPublishInput extends BaseRequest {
  private constructor(
    readonly appId: string,
    readonly kind: TermKind,
    readonly version: number,
    readonly body: string,
  ) {
    super();
  }

  static from(appId: string, kind: string, raw: unknown): TermPublishInput {
    const which = TermKindInput.from(kind).kind;
    return BaseRequest.read(
      { ...(raw as object), appId },
      (f) =>
        new TermPublishInput(
          f.uuid('appId'),
          which,
          f.integer('version', 0, 1_000_000),
          f.text('body', 60_000),
        ),
    );
  }
}
