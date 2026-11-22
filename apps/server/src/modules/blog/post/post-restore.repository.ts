import type { Sql } from '../../platform';
import type { RestoredApp } from '../app/restored-app';
import { RestoredAppCode } from '../app-code/restored-app-code';
import type { RestoredPost } from './post-restore';

// 복원의 blog 쓰기. 앱(+ 코드 버전 1) + 글 + 첫 판 + 참고 wiki + 사진 행을 새 행으로만 넣는다.
// 칸은 RestoredApp · RestoredPost가 정한다. outbox에는 남기지 않는다.
export class PostRestoreRepository {
  constructor(private readonly tx: Sql) {}

  /** 있는 앱 · 글의 수 (휴지통 포함: 주소를 차지한다). 끝날 때까지 새 앱 · 글이 끼어들지 못하게 잠근다 */
  async existing(): Promise<readonly [number, number]> {
    await this.tx`LOCK TABLE blog.apps, blog.posts IN SHARE ROW EXCLUSIVE MODE`;
    const [row] = await this.tx<{ apps: number; posts: number }[]>`
      SELECT (SELECT count(*)::int FROM blog.apps) AS apps, (SELECT count(*)::int FROM blog.posts) AS posts`;
    return [Number(row?.apps), Number(row?.posts)];
  }

  /** withIcon: 아이콘 파일이 들어왔을 때만 아이콘을 가리킨다. code: 백업 때 보이던 코드가 있으면 버전 1로 */
  async saveApp(
    spaceId: string,
    app: RestoredApp,
    withIcon: boolean,
    code: RestoredAppCode | null,
  ): Promise<void> {
    const row = app.rowIn(spaceId, withIcon ? app.icon : null);
    const shown = code === null ? row : { ...row, ...code.shown };
    await this.tx`INSERT INTO blog.apps ${this.tx(shown as never)}`;
    if (code === null) return;
    const version = code.versionRow(app.id, spaceId);
    await this.tx`INSERT INTO blog.app_code_versions ${this.tx(version as never)}`;
  }

  /** photos: 이 글에 붙일 사진 중 파일이 들어온 것 (행에 외래키가 있다). appId: 넣을 앱 */
  async save(
    spaceId: string,
    p: RestoredPost,
    photos: readonly string[],
    appId: string | null,
  ): Promise<void> {
    await this.tx`INSERT INTO blog.posts ${this.tx(p.rowIn(spaceId, appId) as never)}`;
    await this.tx`INSERT INTO blog.post_revisions ${this.tx(p.revision as never)}`;
    for (const wikiId of p.refWikiIds)
      await this.tx`INSERT INTO blog.post_wiki_refs ${this.tx({ post_id: p.id, wiki_id: wikiId })}`;
    for (const hash of photos)
      await this.tx`INSERT INTO blog.assets ${this.tx({ post_id: p.id, blob_hash: hash })}`;
  }
}
