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
import type { AppDomainProof } from './app-domain.policy';

// 앱 하나 (blog.apps, 스토어 1단계, docs/스토어.md). 앱 종류(blog · magazine · page)로 만든 서비스 하나이고 바깥 주소는 /<slug>다.
// 비공개로 만들어지고 관리자가 공개로 바꾼다. 방문자에게 앱의 글 · 메뉴 · 호 · 페이지가 보이려면 앱도 공개여야 한다
// (각 Query의 방문자 조건). 종류는 만들 때만 정한다. 공개 여부가 바뀌거나 지우면 blog.app.changed로 알린다 (vault의 그래프 사본).
export class App extends TableEntity<AppRow, AppNew> {
  static readonly PUBLIC: AppVisibility = 'public';
  static readonly PAGE: AppKind = 'page';
  /** 커뮤니티 (스토어 3-1): 회원 · 글 · 댓글은 community 모듈에 있다. 메뉴 · 블로그 글 · 페이지를 두지 않고 지우지 않는다 */
  static readonly COMMUNITY: AppKind = 'community';
  static readonly NAME_MAX = 40;
  static readonly SLUG_MIN = 2;
  static readonly SLUG_MAX = 30;
  static readonly DESCRIPTION_MAX = 200;
  static readonly SORT_MAX = 1000;
  /** 편집 방침 (메뉴의 방침과 같은 한도, DB CHECK) */
  static readonly POLICY_MAX = 4000;
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
    'share',
    'store',
  ];
  private static readonly SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
  /** 도메인 모양 (DB CHECK apps_domain_format과 같다): 점으로 나눈 이름 둘 이상, 끝은 영어 또는 xn-- */
  private static readonly DOMAIN =
    /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+([a-z]{2,63}|xn--[a-z0-9-]{1,59})$/;
  private static readonly DOMAIN_LENGTH = [4, 253] as const;

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
    policy: (value) => {
      if (value.length > App.POLICY_MAX)
        throw new RuleViolation(`편집 방침은 ${App.POLICY_MAX}자까지예요`);
      return value;
    },
    // 운영 팀장이 맨 위의, 비공개를 읽지 않는 에이전트인지는 Service가 트랜잭션 전에 본다 (AppTeam.assertLeader)
    agent_id: (value) => value,
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

  /**
   * 도메인 규칙 (스토어 3-0): 도메인만 받는다 (https:// · 포트 · 경로 없이). 소문자로, 국제 도메인은 xn-- 꼴로 바꿔 둔다.
   * IP 주소 · localhost와 사이트 주소의 도메인(콘솔이 있는 기본 도메인)은 받지 않는다. 다른 앱과 겹침은 AppEdit이 미리, DB UNIQUE가 끝에 본다
   */
  static checkDomain(value: string, siteHost: string | null): string {
    const text = value.trim().toLowerCase().replace(/\.$/, '');
    if (!/^[^\s/:@?#\\[\]]+$/.test(text))
      throw new RuleViolation(
        '도메인만 적어 주세요 (예: blog.example.com). https:// · 포트 · 경로는 빼요',
      );
    let host: string;
    try {
      host = new URL(`https://${text}`).hostname;
    } catch {
      throw new RuleViolation('도메인 모양이 아니에요 (예: blog.example.com)');
    }
    if (/^\d+$/.test(host.split('.').at(-1) ?? ''))
      throw new RuleViolation('IP 주소는 도메인으로 쓸 수 없어요');
    if (host === 'localhost' || host.endsWith('.localhost'))
      throw new RuleViolation('localhost는 도메인으로 쓸 수 없어요');
    const [min, max] = App.DOMAIN_LENGTH;
    if (host.length < min || host.length > max || !App.DOMAIN.test(host))
      throw new RuleViolation('도메인 모양이 아니에요 (예: blog.example.com)');
    if (host === siteHost) throw new RuleViolation('사이트 주소와 같은 도메인은 앱에 쓸 수 없어요');
    return host;
  }

  /** 칸 하나를 관리자가 고칠 때와 같은 규칙으로 본다 (복원: RestoredApp) */
  static checked<K extends 'name' | 'description' | 'sort'>(
    column: K,
    value: Unchecked<AppRow>[K],
  ): AppRow[K] {
    const rule = App.RULES[column] as (value: Unchecked<AppRow>[K]) => AppRow[K];
    return rule(value);
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

  /** 운영 팀장 (task의 에이전트 id). 없으면 null */
  get agentId(): string | null {
    return this.row.agent_id;
  }

  get name(): string {
    return this.row.name;
  }

  /** 앱 도메인 (스토어 3-0). 없으면 null */
  get domain(): string | null {
    return this.row.domain;
  }

  /**
   * 관리자가 고친 칸을 적는다. 종류는 바꾸지 않는다. 공개 여부가 바뀌면 알리고,
   * 비공개가 되면 첫 화면 고정도 푼다 (방문자에게 없는 앱이 첫 화면일 수 없다, DB CHECK)
   */
  edit(changes: Partial<Unchecked<AppRow>>, now: Date): void {
    const before = this.row;
    this.accept(changes, App.RULES);
    if (this.row === before) return;
    if (this.row.visibility !== App.PUBLIC) this.put('home', false);
    this.put('updated_at', now);
    if (this.row.visibility !== before.visibility) this.record(this.changed(false));
  }

  /** 방문자 첫 화면(/)으로 고정하거나 푼다 (스토어 2단계). 공개 앱만. 공간에 하나인지는 AppService가 다른 앱을 풀어 지킨다 */
  pinHome(on: boolean, now: Date): void {
    if (on && this.row.visibility !== App.PUBLIC)
      throw new RuleViolation('공개 앱만 첫 화면으로 고정할 수 있어요');
    if (on === this.row.home) return;
    this.put('home', on);
    this.put('updated_at', now);
  }

  /**
   * 도메인을 정하거나 바꾼다 (관리자만, 대화의 제안에는 없다). null · ""은 빼기.
   * 바뀌면 연결 확인을 비운다: 새 도메인은 다시 확인해야 기본 도메인의 앱 주소가 그리로 보낸다
   */
  setDomain(value: string | null, siteHost: string | null, now: Date): void {
    const domain = value === null || value.trim() === '' ? null : App.checkDomain(value, siteHost);
    if (domain === this.row.domain) return;
    this.put('domain', domain);
    this.put('domain_checked_at', null);
    this.put('updated_at', now);
  }

  /** 관리자의 브라우저가 그 도메인에서 읽어 온 확인 값이 맞으면 연결된 도메인으로 적는다. 틀리면 422 */
  confirmDomain(proof: AppDomainProof, token: string, now: Date): void {
    const domain = this.row.domain;
    if (domain === null) throw new RuleViolation('도메인부터 정해 주세요');
    if (!proof.matches(this.id, domain, token))
      throw new RuleViolation('연결되지 않은 도메인이에요. DNS와 프록시 설정을 확인해 주세요');
    this.put('domain_checked_at', now);
    this.put('updated_at', now);
  }

  /** 아이콘 (platform BlobStore의 해시). null은 지우기 */
  setIcon(hash: string | null, now: Date): void {
    if (hash === this.row.icon_blob_hash) return;
    this.put('icon_blob_hash', hash);
    this.put('updated_at', now);
  }

  /** 메뉴를 둘 수 있는가: 페이지 앱은 페이지 하나가 앱의 전부라, 커뮤니티 앱은 회원의 글이 앱의 전부라 메뉴가 없다 */
  assertHoldsMenus(): void {
    if (this.row.kind === App.PAGE) throw new RuleViolation('페이지 앱에는 메뉴를 둘 수 없어요');
    if (this.row.kind === App.COMMUNITY)
      throw new RuleViolation('커뮤니티 앱에는 메뉴를 둘 수 없어요');
  }

  /** 블로그 글을 넣을 수 있는가: 커뮤니티 앱의 글은 회원의 글이다 (community) */
  assertHoldsPosts(): void {
    if (this.row.kind === App.COMMUNITY)
      throw new RuleViolation('커뮤니티 앱에는 블로그 글을 넣을 수 없어요');
  }

  /** 페이지를 넣고 뺄 수 있는 앱인가: 페이지 앱의 페이지는 만들 때 정하고 앱을 지울 때까지 그대로다 */
  assertLoosePages(): void {
    if (this.row.kind === App.PAGE)
      throw new RuleViolation('페이지 앱의 페이지는 바꿀 수 없어요. 앱을 지운 뒤 옮겨 주세요');
  }

  /**
   * 지우기 전에 (Service가 안이 비었는지 본 뒤): 그래프 사본이 이 앱의 글을 숨기게 알린다.
   * 커뮤니티 앱은 지우지 않는다: 회원 · 글이 community에 남아 있다 (비공개로 둔다, 스토어 3-1)
   */
  remove(): void {
    if (this.row.kind === App.COMMUNITY)
      throw new RuleViolation('커뮤니티 앱은 지울 수 없어요. 비공개로 바꿔 주세요');
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
