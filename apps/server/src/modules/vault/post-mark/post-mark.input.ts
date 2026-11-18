import { BaseRequest, type DomainEvent, type RequestFields } from '../../platform';

/** blog.post.* 이벤트의 내용 중 글 자리에 쓰는 칸 */
export class PostEventInput extends BaseRequest {
  private static readonly DELETED = 'blog.post.deleted';
  private static readonly TEXT_MAX = 10_000;
  private static readonly REFS_MAX = 500;
  private static readonly VERSION_MAX = 2_147_483_647;

  private constructor(
    readonly postId: string,
    readonly title: string,
    readonly slug: string,
    readonly status: string,
    readonly postVersion: number,
    readonly mainWikiId: string | null,
    readonly refWikiIds: readonly string[],
    readonly deleted: boolean,
    /** 든 앱 (스토어 1-2). 앱 밖이면 null, 칸이 없는 옛 이벤트면 undefined (지금 값 그대로) */
    readonly appId: string | null | undefined,
  ) {
    super();
  }

  /** 글 버전이 없는 이벤트는 글 자리와 상관없다 (예: 실행 실패 알림) */
  static from(event: DomainEvent): PostEventInput | null {
    if (typeof event.data.postVersion !== 'number') return null;
    return BaseRequest.read(
      event.data,
      (f) =>
        new PostEventInput(
          f.uuid('postId'),
          f.optionalText('title', PostEventInput.TEXT_MAX) ?? '',
          f.optionalText('slug', PostEventInput.TEXT_MAX) ?? '',
          f.optionalText('status', PostEventInput.TEXT_MAX) ?? '',
          f.integer('postVersion', 1, PostEventInput.VERSION_MAX),
          PostEventInput.mainWiki(f, event.data),
          f.optionalTextList('refWikiIds', PostEventInput.REFS_MAX, 36) ?? [],
          event.name === PostEventInput.DELETED,
          PostEventInput.app(f, event.data),
        ),
    );
  }

  private static app(f: RequestFields, data: DomainEvent['data']): string | null | undefined {
    return data.appId === undefined || data.appId === null ? data.appId : f.uuid('appId');
  }

  private static mainWiki(f: RequestFields, data: DomainEvent['data']): string | null {
    return data.mainWikiId === undefined || data.mainWikiId === null ? null : f.uuid('mainWikiId');
  }
}
