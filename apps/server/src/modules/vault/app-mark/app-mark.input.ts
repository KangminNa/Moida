import { BaseRequest, type DomainEvent } from '../../platform';

/** blog.app.changed의 내용 중 앱 공개 여부 사본에 쓰는 칸 */
export class AppEventInput extends BaseRequest {
  private static readonly PUBLIC = 'public';
  private static readonly VERSION_MAX = 2_147_483_647;

  private constructor(
    readonly appId: string,
    readonly isPublic: boolean,
    readonly appVersion: number,
    readonly deleted: boolean,
  ) {
    super();
  }

  static from(event: DomainEvent): AppEventInput {
    return BaseRequest.read(
      event.data,
      (f) =>
        new AppEventInput(
          f.uuid('appId'),
          f.text('visibility', 20) === AppEventInput.PUBLIC,
          f.integer('appVersion', 1, AppEventInput.VERSION_MAX),
          f.boolean('deleted'),
        ),
    );
  }
}
