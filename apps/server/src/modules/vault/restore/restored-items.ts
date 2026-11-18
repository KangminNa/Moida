import { ArchiveFile, type ArchiveRecord, BaseEntity } from '../../platform';
import { ChangeWork } from '../change/change-target';
import { SlugPolicy } from '../slug.policy';
import {
  CATEGORY_ORIGIN,
  type CategoryNew,
  EDGE_DELETED_BY_TYPE,
  EDGE_ORIGIN,
  type EdgeNew,
  type NodeNew,
  type PostMarkNew,
  type PostMarkStatus,
  WIKI_ORIGIN,
  WIKI_VISIBILITY,
  type WikiNew,
  type WikiRevisionActorType,
  type WikiRevisionNew,
} from '../vault.tables';
import { Wiki } from '../wiki/wiki';
import { WikiBody } from '../wiki/wiki-body';

// 보관 파일에서 읽은 vault의 항목들. 복원은 id를 지키고 이벤트를 남기지 않아서 Session·Wiki의 open을 거치지 않지만,
// 칸·해시·찾기용 글은 저장할 때와 같은 객체(SessionNote, WikiBody)로 다시 만든다. 그래야 복원 뒤의 고치기·저장이 그대로 돈다.
// 지금 판이 첫 판이 되고(판 번호 1), 판을 만든 쪽은 system이다.
// 판 id는 파일에 없어 새로 짓는다 (지난 판은 복원하지 않는다). 행의 공간은 넣을 때 정해진다.

/** 복원한 판·선을 만든 쪽 (actor_type) */
const SYSTEM: WikiRevisionActorType = 'system';

/** vault/categories.yml의 항목 하나. 출처·고정이 없는 옛 백업은 사람의 것으로 본다 (AI가 덮지 못하게) */
export class RestoredCategory extends BaseEntity {
  private constructor(
    private readonly fields: Omit<CategoryNew, 'space_id'>,
    /** 점(vault.nodes)이 만들어진 때 */
    private readonly at: Date,
  ) {
    super(fields.node_id, 1);
  }

  static read(record: ArchiveRecord): RestoredCategory {
    const fields = {
      node_id: record.id(),
      name: record.text('name'),
      slug: record.attempt(() => SlugPolicy.check(record.text('slug'))),
      color: record.optionalText('color'),
      description: record.optionalText('description'),
      sort: record.number('sort'),
      origin: record.has('origin') ? record.oneOf('origin', CATEGORY_ORIGIN) : ChangeWork.HUMAN,
      pinned: record.flag('pinned', true),
    };
    return new RestoredCategory(fields, record.createdAt);
  }

  get slug(): string {
    return this.fields.slug;
  }

  /** 이 공간에 넣을 점 */
  nodeIn(spaceId: string): NodeNew {
    return { id: this.id, space_id: spaceId, kind: 'category', created_at: this.at };
  }

  /** 이 공간에 넣을 카테고리 행 */
  rowIn(spaceId: string): CategoryNew {
    return { ...this.fields, space_id: spaceId };
  }
}

/** vault/wikis/<주소>.md 하나. 주소는 파일 이름이다 */
export class RestoredWiki extends BaseEntity {
  private static readonly KNOWN: ReadonlySet<string> = new Set([
    'cairn_format',
    'cairn_type',
    'cairn_id',
    'title',
    'visibility',
    'cairn_category',
    'cairn_origin',
    'cairn_pinned',
  ]);

  private constructor(
    private readonly fields: Omit<WikiNew, 'space_id'>,
    /** 첫 판 */
    readonly revision: WikiRevisionNew,
    /** 점(vault.nodes)이 만들어진 때 */
    private readonly at: Date,
  ) {
    super(fields.node_id, 1);
  }

  static read(record: ArchiveRecord): RestoredWiki {
    const name = record.path.slice(record.path.lastIndexOf('/') + 1, -'.md'.length);
    const body = WikiBody.parse(record.body);
    const fields = {
      node_id: record.id(),
      slug: record.attempt(() => SlugPolicy.check(name)),
      title: record.text('title'),
      visibility: record.oneOf('visibility', WIKI_VISIBILITY),
      category_id: record.optionalId('cairn_category'),
      origin: record.has('cairn_origin')
        ? record.oneOf('cairn_origin', WIKI_ORIGIN)
        : ChangeWork.HUMAN,
      // 옛 백업에는 사람이 고친 칸의 표시가 없다. 모두 사람의 것으로 두어 AI가 바로 덮지 못하게 한다
      pinned_sections: record.has('cairn_pinned')
        ? record.texts('cairn_pinned')
        : [Wiki.TITLE_KEY, ...body.sections.map((s) => s.key)],
    };
    const at = record.createdAt;
    const meta = ArchiveFile.metaOf(record.unknownKeys(RestoredWiki.KNOWN));
    const revision = { id: BaseEntity.newId(), seq: 1, actor_type: SYSTEM, created_at: at };
    return new RestoredWiki(
      {
        ...fields,
        head_revision_id: revision.id,
        head_text: body.markdown,
        revision_count: 1,
        created_at: at,
        updated_at: at,
        meta,
      },
      { ...revision, wiki_id: fields.node_id, kind: fields.origin, ...body.revision() },
      at,
    );
  }

  get slug(): string {
    return this.fields.slug;
  }

  get categoryId(): string | null {
    return this.fields.category_id ?? null;
  }

  /** 이 공간에 넣을 점 */
  nodeIn(spaceId: string): NodeNew {
    return { id: this.id, space_id: spaceId, kind: 'wiki', created_at: this.at };
  }

  /** 이 공간에 넣을 wiki 행 */
  rowIn(spaceId: string): WikiNew {
    return { ...this.fields, space_id: spaceId };
  }
}

/** vault/graph.json의 선 하나. 지운 선도 행으로 돌아와 사람이 지운 선을 AI가 다시 만들지 못한다 */
export class RestoredEdge extends BaseEntity {
  private constructor(private readonly fields: Omit<EdgeNew, 'space_id'>) {
    super(fields.id, 1);
  }

  static read(record: ArchiveRecord): RestoredEdge {
    return new RestoredEdge({
      id: record.id(),
      src: record.id('src'),
      dst: record.id('dst'),
      kind: record.text('kind'),
      weight: record.optionalNumber('weight'),
      origin: record.oneOf('origin', EDGE_ORIGIN),
      pinned: record.flag('pinned', false),
      actor_type: SYSTEM,
      deleted_at: record.date('deleted_at'),
      // 값 목록 밖이면 예전에는 넣을 때 DB의 CHECK가 막았다. 이제 파일을 읽을 때 알린다
      deleted_by_type:
        record.optionalText('deleted_by') === null
          ? null
          : record.oneOf('deleted_by', EDGE_DELETED_BY_TYPE),
      created_at: record.createdAt,
    });
  }

  get src(): string {
    return this.fields.src;
  }

  get dst(): string {
    return this.fields.dst;
  }

  /** 이 공간에 넣을 선 행 */
  rowIn(spaceId: string): EdgeNew {
    return { ...this.fields, space_id: spaceId };
  }
}

/** vault/graph.json의 고정한 점 위치 하나 */
export class RestoredPin extends BaseEntity {
  private constructor(
    readonly view: string,
    readonly node: string,
    readonly x: number,
    readonly y: number,
  ) {
    super(`${view}/${node}`, 1);
  }

  static read(record: ArchiveRecord): RestoredPin {
    return new RestoredPin(
      record.text('view'),
      record.id('node'),
      record.number('x'),
      record.number('y'),
    );
  }
}

/**
 * 글 자리 사본 한 행. vault는 blog를 읽지 못하고 복원은 이벤트를 남기지 않으므로,
 * blog의 표나 코드가 아니라 보관 형식의 글 파일 앞부분을 읽어 채운다. 글 버전은 복원된 글의 첫 버전이다.
 */
export class RestoredPostMark extends BaseEntity {
  private static readonly PUBLISHED: PostMarkStatus = 'published';
  private static readonly DRAFT: PostMarkStatus = 'draft';

  private constructor(
    private readonly fields: Omit<PostMarkNew, 'space_id' | 'main_wiki_id'>,
    /** 글 파일이 가리키는 대표 wiki. 그 wiki가 복원되지 않으면 비운다 (외래키) */
    readonly mainWikiId: string | null,
  ) {
    super(fields.post_id, 1);
  }

  static read(record: ArchiveRecord): RestoredPostMark {
    const published = record.text('status') === RestoredPostMark.PUBLISHED;
    const fields = {
      post_id: record.id(),
      title: record.text('title'),
      slug: record.text('slug'),
      status: published ? RestoredPostMark.PUBLISHED : RestoredPostMark.DRAFT,
    };
    const mainWikiId = record.optionalId('cairn_main_wiki');
    // 든 앱 (스토어 1-2): 앱을 싣는 백업(cairn_app, 1-3)만 안다. 모르면 비워 두어 방문자 그래프에서 숨긴다
    const app = record.optionalId('cairn_app');
    return new RestoredPostMark(
      { ...fields, ref_wiki_ids: record.ids('cairn_ref_wikis'), post_version: 1, app_id: app },
      mainWikiId,
    );
  }

  /** 이 공간에 넣을 사본 행. mainWikiId: 복원되는 wiki일 때만 */
  rowIn(spaceId: string, mainWikiId: string | null): PostMarkNew {
    return { ...this.fields, space_id: spaceId, main_wiki_id: mainWikiId };
  }
}
