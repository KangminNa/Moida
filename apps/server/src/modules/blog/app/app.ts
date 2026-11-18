import {
  BaseEntity,
  type ColumnRules,
  DomainEvent,
  RuleViolation,
  TableEntity,
  type Unchecked,
  ValueList,
} from '../../platform';
import {
  APP_KIND,
  APP_VISIBILITY,
  type AppKind,
  type AppNew,
  type AppRow,
  type AppVisibility,
} from '../blog.tables';
import { AppView } from './app.view';

// 앱 하나 (blog.apps, 스토어 1단계, docs/스토어.md). 앱 종류(blog · magazine · page)로 만든 서비스 하나이고 바깥 주소는 /<slug>다.
// 비공개로 만들어지고 관리자가 공개로 바꾼다. 방문자에게 앱의 글 · 메뉴 · 호 · 페이지가 보이려면 앱도 공개여야 한다
// (각 Query의 방문자 조건). 종류는 만들 때만 정한다. 공개 여부가 바뀌거나 지우면 blog.app.changed로 알린다 (vault의 그래프 사본).
export class App extends TableEntity<AppRow, AppNew> {
  static readonly PUBLIC: AppVisibility = 'public';
  static readonly PAGE: AppKind = 'page';
  static readonly NAME_MAX = 40;
  static readonly SLUG_MIN = 2;
  static readonly SLUG_MAX = 30;
  static readonly DESCRIPTION_MAX = 200;
  static readonly SORT_MAX = 1000;
  /**
   * 앱 주소로 못 쓰는 이름: 웹의 최상위 경로 · 서버로 넘기는 경로와 겹치거나 겹칠 이름.
   * 점 · 밑줄이 든 이름(_next · .well-known · sw.js)은 주소 모양에서 이미 막힌다
   */
  static readonly RESERVED: readonly string[] = [
    'admin',
    'api',
    'apps',
    'assets',
    'connect',
    'files',
    'graph',
    'install',
    'login',
    'm',
    'mcp',
    'oauth',
    'pages',
    'posts',
    'rss',
    'store',
  ];
  private static readonly SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

  /** 관리자가 정하는 칸과 그 규칙 (종류는 만들 때 open이 본다) */
  private static readonly RULES: ColumnRules<AppRow> = {
    name: (value) => {
      const name = value.trim();
      if (name.length < 1 || name.length > App.NAME_MAX)
        throw new RuleViolation(`앱 이름은 1~${App.NAME_MAX}자예요`);
      return name;
    },
    slug: (value) => App.checkSlug(value),
    description: (value) => {
      const text = value.trim();
      if (text.length > App.DESCRIPTION_MAX)
        throw new RuleViolation(`설명은 ${App.DESCRIPTION_MAX}자까지예요`);
      return text;
    },
    sort: (value) => {
      if (!Number.isInteger(value) || value < 0 || value > App.SORT_MAX)
        throw new RuleViolation(`순서는 0~${App.SORT_MAX}예요`);
      return value;
    },
    visibility: (value) => {
      if (!ValueList.has(APP_VISIBILITY, value))
        throw new RuleViolation(`공개 여부는 ${APP_VISIBILITY.join(' · ')} 중 하나예요`);
      return value;
    },
  };

  /** 주소 규칙: 영어 소문자 · 숫자 · 하이픈, 못 쓰는 이름 제외 (겹침은 DB의 UNIQUE가 본다) */
  static checkSlug(value: string): string {
    const slug = value.trim();
    if (slug.length < App.SLUG_MIN || slug.length > App.SLUG_MAX || !App.SLUG.test(slug))
      throw new RuleViolation(
        `앱 주소는 영어 소문자 · 숫자 · 하이픈 ${App.SLUG_MIN}~${App.SLUG_MAX}자예요`,
      );
    if (App.RESERVED.includes(slug)) throw new RuleViolation(`${slug}는 앱 주소로 쓸 수 없어요`);
    return slug;
  }

  /** 새 앱: 늘 비공개로 만든다 (공개는 관리자가 앱 관리에서) */
  static open(spaceId: string, kind: string, fields: Partial<Unchecked<AppRow>>, now: Date): App {
    if (!ValueList.has(APP_KIND, kind))
      throw new RuleViolation(`앱 종류는 ${APP_KIND.join(' · ')} 중 하나예요`);
    const app = new App(
      {
        id: BaseEntity.newId(),
        space_id: spaceId,
        kind,
        name: '',
        slug: '',
        visibility: 'private',
        created_at: now,
        updated_at: now,
      },
      true,
    );
    const { visibility: _private, ...rest } = fields;
    app.accept({ description: '', sort: 0, ...rest }, App.RULES);
    return app;
  }

  static restore(row: AppRow): App {
    return new App(row);
  }

  get spaceId(): string {
    return this.row.space_id;
  }

  get kind(): AppKind {
    return this.row.kind;
  }

  get slug(): string {
    return this.row.slug;
  }

  /** 관리자가 고친 칸을 적는다. 종류는 바꾸지 않는다. 공개 여부가 바뀌면 알린다 */
  edit(changes: Partial<Unchecked<AppRow>>, now: Date): void {
    const before = this.row;
    this.accept(changes, App.RULES);
    if (this.row === before) return;
    this.put('updated_at', now);
    if (this.row.visibility !== before.visibility) this.record(this.changed(false));
  }

  /** 아이콘 (platform BlobStore의 해시). null은 지우기 */
  setIcon(hash: string | null, now: Date): void {
    if (hash === this.row.icon_blob_hash) return;
    this.put('icon_blob_hash', hash);
    this.put('updated_at', now);
  }

  /** 메뉴를 둘 수 있는가: 페이지 앱은 페이지 하나가 앱의 전부라 메뉴가 없다 */
  assertHoldsMenus(): void {
    if (this.row.kind === App.PAGE) throw new RuleViolation('페이지 앱에는 메뉴를 둘 수 없어요');
  }

  /** 페이지를 넣고 뺄 수 있는 앱인가: 페이지 앱의 페이지는 만들 때 정하고 앱을 지울 때까지 그대로다 */
  assertLoosePages(): void {
    if (this.row.kind === App.PAGE)
      throw new RuleViolation('페이지 앱의 페이지는 바꿀 수 없어요. 앱을 지운 뒤 옮겨 주세요');
  }

  /** 지우기 전에 (Service가 안이 비었는지 본 뒤): 그래프 사본이 이 앱의 글을 숨기게 알린다 */
  remove(): void {
    this.record(this.changed(true));
  }

  view(): AppView {
    return new AppView(this.row);
  }

  /** vault의 사본이 순서를 맞추도록 저장 뒤의 앱 버전을 함께 보낸다 */
  private changed(deleted: boolean): DomainEvent {
    return new DomainEvent('blog.app.changed', 1, this.row.space_id, {
      appId: this.id,
      visibility: this.row.visibility,
      appVersion: this.isNew ? 1 : this.version + 1,
      deleted,
    });
  }
}
