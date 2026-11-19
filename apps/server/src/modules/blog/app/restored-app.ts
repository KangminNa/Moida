import { type ArchiveRecord, BaseEntity, Blob } from '../../platform';
import { APP_KIND, APP_VISIBILITY, type AppNew } from '../blog.tables';
import { App } from './app';

/**
 * blog/apps/<주소>.yml의 앱 하나 (스토어 1-3, docs/보관형식.md). id · 종류 · 공개 여부를 지키고,
 * 칸은 관리자가 고칠 때와 같은 규칙으로 본다. 만든 때는 id(UUIDv7)에서 다시 얻는다. 판은 1부터 다시
 */
export class RestoredApp extends BaseEntity {
  private static readonly KNOWN: ReadonlySet<string> = new Set([
    'cairn_id',
    'kind',
    'name',
    'slug',
    'description',
    'visibility',
    'sort',
    'icon',
    'home',
  ]);

  private constructor(
    /** 앱 행. 공간은 넣을 때 정해진다 */
    private readonly fields: Omit<AppNew, 'space_id' | 'icon_blob_hash'>,
    /** 아이콘 사진의 해시 */
    readonly icon: string | null,
  ) {
    super(fields.id, 1);
  }

  static read(record: ArchiveRecord): RestoredApp {
    const unknown = Object.keys(record.unknownKeys(RestoredApp.KNOWN));
    if (unknown.length > 0)
      throw record.problem(`앱 파일에는 모르는 키를 둘 수 없어요: ${unknown.join(', ')}`);
    const icon = record.optionalText('icon');
    if (icon !== null && !Blob.isHash(icon))
      throw record.problem(`icon의 해시가 틀렸어요: ${icon}`);
    const at = record.createdAt;
    const visibility = record.oneOf('visibility', APP_VISIBILITY);
    const home = record.flag('home', false);
    if (home && visibility !== App.PUBLIC)
      throw record.problem('첫 화면으로 고정한 앱은 공개 앱이어야 해요');
    return new RestoredApp(
      {
        id: record.id(),
        kind: record.oneOf('kind', APP_KIND),
        name: record.attempt(() => App.checked('name', record.text('name'))),
        slug: record.attempt(() => App.checkSlug(record.text('slug'))),
        description: record.attempt(() =>
          App.checked('description', record.optionalText('description') ?? ''),
        ),
        visibility,
        home,
        sort: record.attempt(() => App.checked('sort', record.number('sort'))),
        created_at: at,
        updated_at: at,
      },
      icon,
    );
  }

  /**
   * 앱이 생기기 전의 백업(앱 파일 없이 공개 · 링크 공개 글이 있는 묶음)의 글을 넣을 기본 앱.
   * 마이그레이션과 같은 블로그 · /blog · 공개이고, id는 공간 id다: vault의 복원도 같은 규칙으로 그래프 사본을 만든다
   */
  static former(spaceId: string): RestoredApp {
    return new RestoredApp(
      {
        id: spaceId,
        kind: 'blog',
        name: '블로그',
        slug: 'blog',
        visibility: App.PUBLIC,
      },
      null,
    );
  }

  get slug(): string {
    return this.fields.slug;
  }

  /** 방문자 첫 화면으로 고정한 앱 (스토어 2단계, 묶음에 하나까지) */
  get home(): boolean {
    return this.fields.home === true;
  }

  get isPage(): boolean {
    return this.fields.kind === App.PAGE;
  }

  /** 이 공간에 넣을 앱 행. icon: 파일이 들어온 아이콘만 */
  rowIn(spaceId: string, icon: string | null): AppNew {
    return { ...this.fields, space_id: spaceId, icon_blob_hash: icon };
  }
}
