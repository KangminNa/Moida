import type { Sql } from '../../platform';
import type { RestoredPost } from './post-restore';

// 복원의 blog 쓰기. 글 + 첫 판 + 참고 wiki + 사진 행을 새 행으로만 넣는다.
// 칸은 RestoredPost가 정한다. outbox에는 남기지 않는다.
export class PostRestoreRepository {
  constructor(private readonly tx: Sql) {}

  /** 있는 글의 수 (휴지통 포함: 주소를 차지한다). 끝날 때까지 새 글이 끼어들지 못하게 잠근다 */
  async existing(): Promise<number> {
    await this.tx`LOCK TABLE blog.posts IN SHARE ROW EXCLUSIVE MODE`;
    const [row] = await this.tx<{ n: number }[]>`SELECT count(*)::int AS n FROM blog.posts`;
    return Number(row?.n);
  }

  /** 복원한 글을 넣을 기본 앱 (블로그, 주소 blog, 공개: 마이그레이션과 같은 규칙). 이미 있으면 그 앱 */
  async defaultApp(spaceId: string): Promise<string> {
    await this.tx`
      INSERT INTO blog.apps (space_id, kind, name, slug, visibility)
      VALUES (${spaceId}, 'blog', '블로그', 'blog', 'public')
      ON CONFLICT (space_id, slug) DO NOTHING`;
    const [row] = await this.tx<{ id: string }[]>`
      SELECT id FROM blog.apps WHERE space_id = ${spaceId} AND slug = 'blog'`;
    if (!row) throw new Error('기본 앱을 만들지 못했어요');
    return row.id;
  }

  /** photos: 이 글에 붙일 사진 중 파일이 들어온 것 (행에 외래키가 있다). appId: 넣을 앱 */
  async save(
    spaceId: string,
    p: RestoredPost,
    photos: readonly string[],
    appId: string,
  ): Promise<void> {
    await this
      .tx`INSERT INTO blog.posts ${this.tx({ ...p.rowIn(spaceId), app_id: appId } as never)}`;
    await this.tx`INSERT INTO blog.post_revisions ${this.tx(p.revision as never)}`;
    for (const wikiId of p.refWikiIds)
      await this.tx`INSERT INTO blog.post_wiki_refs ${this.tx({ post_id: p.id, wiki_id: wikiId })}`;
    for (const hash of photos)
      await this.tx`INSERT INTO blog.assets ${this.tx({ post_id: p.id, blob_hash: hash })}`;
  }
}
