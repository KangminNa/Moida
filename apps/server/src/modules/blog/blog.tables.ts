// 자동으로 만든 파일이라 고치지 않는다. 마이그레이션 뒤 pnpm db:rows로 다시 만든다 (scripts/db-rows.mjs).
// 표 하나에 인터페이스 하나. 칼럼 이름은 DB 그대로다.
// <이름>New는 새 행에 꼭 적어야 하는 칸이고, 나머지는 DB가 채운다.

/** blog.apps.kind (값 목록 CHECK) */
export const APP_KIND = ['blog', 'magazine', 'page'] as const;
export type AppKind = (typeof APP_KIND)[number];
/** blog.apps.visibility (값 목록 CHECK) */
export const APP_VISIBILITY = ['private', 'public'] as const;
export type AppVisibility = (typeof APP_VISIBILITY)[number];
/** blog.apps */
export interface AppRow {
  id: string;
  space_id: string;
  kind: AppKind;
  name: string;
  slug: string;
  description: string;
  visibility: AppVisibility;
  sort: number;
  icon_blob_hash: string | null;
  version: number;
  created_at: Date;
  updated_at: Date;
}
export type AppNew = Partial<AppRow> & Pick<AppRow, 'id' | 'space_id' | 'kind' | 'name' | 'slug'>;

/** blog.assets */
export interface AssetRow {
  post_id: string;
  blob_hash: string;
  alt: string | null;
  caption: string | null;
}
export type AssetNew = Partial<AssetRow> & Pick<AssetRow, 'post_id' | 'blob_hash'>;

/** blog.issues.status (값 목록 CHECK) */
export const ISSUE_STATUS = ['draft', 'published'] as const;
export type IssueStatus = (typeof ISSUE_STATUS)[number];
/** blog.issues */
export interface IssueRow {
  id: string;
  space_id: string;
  title: string;
  intro: string | null;
  created_at: Date;
  menu_id: string;
  number: number;
  status: IssueStatus;
  published_at: Date | null;
  version: number;
  updated_at: Date;
}
export type IssueNew = Partial<IssueRow> & Pick<IssueRow, 'id' | 'space_id' | 'title' | 'menu_id' | 'number'>;

/** blog.menus.kind (값 목록 CHECK) */
export const MENU_KIND = ['posts', 'issues', 'pages', 'page'] as const;
export type MenuKind = (typeof MENU_KIND)[number];
/** blog.menus */
export interface MenuRow {
  id: string;
  space_id: string;
  name: string;
  slug: string;
  sort: number;
  version: number;
  kind: MenuKind;
  policy: string;
  agent_id: string | null;
  rss: boolean;
  created_at: Date;
  updated_at: Date;
  app_id: string;
}
export type MenuNew = Partial<MenuRow> & Pick<MenuRow, 'id' | 'space_id' | 'name' | 'slug' | 'app_id'>;

/** blog.page_revisions */
export interface PageRevisionRow {
  id: string;
  page_id: string;
  seq: number;
  files: unknown;
  task_id: string;
  run_id: string;
  note: string;
  created_at: Date;
}
export type PageRevisionNew = Partial<PageRevisionRow> & Pick<PageRevisionRow, 'id' | 'page_id' | 'seq' | 'files' | 'task_id' | 'run_id'>;

/** blog.pages.visibility (값 목록 CHECK) */
export const PAGE_VISIBILITY = ['private', 'public'] as const;
export type PageVisibility = (typeof PAGE_VISIBILITY)[number];
/** blog.pages */
export interface PageRow {
  id: string;
  space_id: string;
  name: string;
  title: string;
  visibility: PageVisibility;
  current_seq: number;
  revisions: number;
  version: number;
  created_at: Date;
  updated_at: Date;
  direction: string;
  pending_seq: number | null;
  menu_id: string | null;
  app_id: string | null;
}
export type PageNew = Partial<PageRow> & Pick<PageRow, 'id' | 'space_id' | 'name' | 'title' | 'current_seq' | 'revisions'>;

/** blog.post_revisions.actor_type (값 목록 CHECK) */
export const POST_REVISION_ACTOR_TYPE = ['user', 'device', 'ai', 'system'] as const;
export type PostRevisionActorType = (typeof POST_REVISION_ACTOR_TYPE)[number];
/** blog.post_revisions */
export interface PostRevisionRow {
  id: string;
  post_id: string;
  seq: number;
  body_md: string;
  base_revision_id: string | null;
  request_id: string | null;
  actor_type: PostRevisionActorType;
  actor_id: string | null;
  created_at: Date;
  title: string;
}
export type PostRevisionNew = Partial<PostRevisionRow> & Pick<PostRevisionRow, 'id' | 'post_id' | 'seq' | 'body_md' | 'actor_type' | 'title'>;

/** blog.post_wiki_refs */
export interface PostWikiRefRow {
  post_id: string;
  wiki_id: string;
  added_at: Date;
}
export type PostWikiRefNew = Partial<PostWikiRefRow> & Pick<PostWikiRefRow, 'post_id' | 'wiki_id'>;

/** blog.posts.status (값 목록 CHECK) */
export const POST_STATUS = ['draft', 'published', 'unlisted'] as const;
export type PostStatus = (typeof POST_STATUS)[number];
/** blog.posts.align (값 목록 CHECK) */
export const POST_ALIGN = ['left', 'center'] as const;
export type PostAlign = (typeof POST_ALIGN)[number];
/** blog.posts */
export interface PostRow {
  id: string;
  space_id: string;
  slug: string;
  status: PostStatus;
  title: string | null;
  excerpt: string | null;
  head_text: string | null;
  head_revision_id: string | null;
  version: number;
  menu_id: string | null;
  issue_id: string | null;
  issue_order: number | null;
  tags: readonly string[];
  cover_blob_hash: string | null;
  align: PostAlign;
  published_at: Date | null;
  updated_at: Date;
  deleted_at: Date | null;
  purge_after: Date | null;
  meta: unknown;
  main_wiki_id: string | null;
  app_id: string | null;
}
export type PostNew = Partial<PostRow> & Pick<PostRow, 'id' | 'space_id' | 'slug'>;

/** work.basket_items.kind (값 목록 CHECK) */
export const BASKET_ITEM_KIND = ['session', 'post', 'photo', 'file', 'link', 'note'] as const;
export type BasketItemKind = (typeof BASKET_ITEM_KIND)[number];
/** work.basket_items.actor_type (값 목록 CHECK) */
export const BASKET_ITEM_ACTOR_TYPE = ['user', 'device', 'ai', 'system'] as const;
export type BasketItemActorType = (typeof BASKET_ITEM_ACTOR_TYPE)[number];
/** work.basket_items */
export interface BasketItemRow {
  id: string;
  basket_id: string;
  kind: BasketItemKind;
  ref_id: string | null;
  blob_hash: string | null;
  url: string | null;
  title: string | null;
  note: string | null;
  sort: number;
  actor_type: BasketItemActorType;
  actor_id: string | null;
  created_at: Date;
}
export type BasketItemNew = Partial<BasketItemRow> & Pick<BasketItemRow, 'id' | 'basket_id' | 'kind' | 'actor_type'>;

/** work.baskets */
export interface BasketRow {
  id: string;
  space_id: string;
  name: string;
  created_at: Date;
  archived_at: Date | null;
}
export type BasketNew = Partial<BasketRow> & Pick<BasketRow, 'id' | 'space_id'>;
