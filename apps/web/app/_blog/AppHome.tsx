import { serverGet } from '../_lib/server-api';
import { appPath, menuPath } from './format';
import { IssueBody } from './IssueBody';
import { PageFrame } from './PageFrame';
import { PostList } from './PostList';
import type {
  PostList as PostPage,
  PublicApp,
  PublicIssue,
  PublicIssueList,
  PublicMenuList,
  PublicPageList,
} from './types';

// 앱의 첫 화면 (스토어 1-4, /<앱>과 공개 앱이 하나뿐일 때의 /): 블로그는 설명 · 글 목록, 매거진은 최신 호, 페이지 앱은 그 페이지.
// 방문자로 묻는다 (관리자가 열어도 방문자가 보는 그대로).
export async function AppHome({ app, cursor }: { app: PublicApp; cursor: string | null }) {
  if (app.kind === 'page') return <PageHome app={app} />;
  if (app.kind === 'magazine') return <MagazineHome app={app} />;
  const after = cursor ? `&cursor=${encodeURIComponent(cursor)}` : '';
  const list = await serverGet<PostPage>(
    `/api/posts?app=${encodeURIComponent(app.slug)}${after}`,
    true,
  );
  return (
    <main className="blog-main">
      {app.description && <p className="blog-intro">{app.description}</p>}
      {!list ? (
        <p className="blog-empty">서버에 연결하지 못했어요</p>
      ) : (
        <PostList
          posts={list.posts}
          more={list.next ? `${appPath(app.slug)}?cursor=${encodeURIComponent(list.next)}` : null}
        />
      )}
    </main>
  );
}

/** 매거진: 첫 호 목록 메뉴의 가장 새 호를 글까지. 지난 호는 그 메뉴에서 */
async function MagazineHome({ app }: { app: PublicApp }) {
  const query = `app=${encodeURIComponent(app.slug)}`;
  const menus = await serverGet<PublicMenuList>(`/api/menus?${query}`, true);
  const menu = menus?.menus.find((m) => m.kind === 'issues') ?? null;
  const issues = menu
    ? await serverGet<PublicIssueList>(
        `/api/issues?${query}&menu=${encodeURIComponent(menu.slug)}`,
        true,
      )
    : null;
  const [latest] = issues?.issues ?? [];
  const issue =
    menu && latest
      ? await serverGet<PublicIssue>(
          `/api/issues/by-number/${encodeURIComponent(app.slug)}/${encodeURIComponent(menu.slug)}/${latest.number}`,
          true,
        )
      : null;
  return (
    <main className="blog-main">
      {app.description && <p className="blog-intro">{app.description}</p>}
      {!menu || !issue ? (
        <p className="blog-empty">발행한 호 없음</p>
      ) : (
        <>
          <IssueBody issue={issue} app={app.slug} />
          {(issues?.issues.length ?? 0) > 1 && (
            <a className="blog-more" href={menuPath(menu.slug, app.slug)}>
              지난 호 모두 보기
            </a>
          )}
        </>
      )}
    </main>
  );
}

/** 페이지 앱: 앱에 든 페이지 하나를 격리된 틀로 */
async function PageHome({ app }: { app: PublicApp }) {
  const list = await serverGet<PublicPageList>(
    `/api/pages?app=${encodeURIComponent(app.slug)}`,
    true,
  );
  const [page] = list?.pages ?? [];
  return (
    <main className="blog-main wide">
      {page ? <PageFrame page={page} /> : <p className="blog-empty">공개한 페이지 없음</p>}
    </main>
  );
}
