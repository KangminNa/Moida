import type {
  AppListView,
  AppView,
  PublicAppListView,
  PublicAppView,
} from '../../../server/src/modules/blog/app/app.view';
import type {
  AppCodeChangesView,
  AppCodePreviewView,
  AppCodeStateView,
  AppCodeView,
} from '../../../server/src/modules/blog/app-code/app-code.view';
import type {
  AppScreenRedirectView,
  AppScreenView,
} from '../../../server/src/modules/blog/app-code/app-screen.view';
import type { AssetView } from '../../../server/src/modules/blog/asset/asset.view';
import type {
  BasketItemView,
  BasketView,
} from '../../../server/src/modules/blog/basket/basket.view';
import type {
  IssueDetailView,
  IssueListView,
} from '../../../server/src/modules/blog/issue/issue.view';
import type {
  MenuListView,
  PublicMenuListView,
} from '../../../server/src/modules/blog/menu/menu.view';
import type {
  PageChangesView,
  PageDetailView,
  PageListView,
  PublicPageListView,
} from '../../../server/src/modules/blog/page/page.view';
import type {
  PostCountsView,
  PostPageView,
  PostSummaryView,
  PostView,
  PublicPostPageView,
  PublicPostSummaryView,
  PublicPostView,
  SavedPostView,
} from '../../../server/src/modules/blog/post/post.view';

// 서버가 돌려주는 모양. import 없는 view 파일의 toJSON()이 원본이다 (객체설계 6장).
// 서버 코드가 웹 번들에 들어가지 않게 반드시 import type으로만 가져온다.

/** 글 목록의 한 줄 (방문자가 보는 것) */
export type PostSummary = ReturnType<PublicPostSummaryView['toJSON']>;
/** 관리 화면 글 목록의 한 줄 */
export type AdminPostSummary = ReturnType<PostSummaryView['toJSON']>;
/** 글의 공개 범위: 초안(나만) · 공개(목록에 보임) · 링크 공개(주소로만) */
export type PostStatus = AdminPostSummary['status'];
/** 관리 화면 탭의 글 수 */
export type PostCounts = ReturnType<PostCountsView['toJSON']>;
/** 목록 한 쪽 (방문자). next가 있으면 ?cursor=next로 다음 쪽 */
export type PostList = ReturnType<PublicPostPageView['toJSON']>;
/** 목록 한 쪽 (주인): 공개 범위와 탭별 글 수까지 */
export type AdminPostList = ReturnType<PostPageView['toJSON']>;
/** 주인이 불러오는 글 (편집기 · 승인): 공개 범위 · 버전 · wiki 연결까지 */
export type EditablePost = ReturnType<PostView['toJSON']>;
/** 글 페이지. 주인이 열면 공개 범위까지 온다 (초안 미리 보기) */
export type PostPage = ReturnType<PublicPostView['toJSON']> & Partial<Pick<EditablePost, 'status'>>;
/** 쓰기 결과 (편집기). revised: 이번 저장으로 새 판이 생겼나 */
export type SavedPost = ReturnType<SavedPostView['toJSON']>;
/** 올린 사진. url을 글 본문에 넣는다 */
export type Asset = ReturnType<AssetView['toJSON']>;
/** 소재 하나 (세션 · 글 · 링크 · 메모) */
export type BasketItem = ReturnType<BasketItemView['toJSON']>;
export type Basket = ReturnType<BasketView['toJSON']>;
/** 페이지 목록 (AI가 만든 HTML 묶음). lastTaskId: 마지막 판을 만든 작업 */
export type PageList = ReturnType<PageListView['toJSON']>;
/** 방문자가 보는 공개 페이지 목록: 이름 · 제목 · 고친 때 */
export type PublicPageList = ReturnType<PublicPageListView['toJSON']>;
/** 페이지 하나와 판 목록 (새 판부터) */
export type PageDetail = ReturnType<PageDetailView['toJSON']>;
export type PageRevision = PageDetail['revisionList'][number];
/** 판 하나의 바뀐 점 (앞 판과 비교한 data.json, 2차 5단계 자라는 페이지) */
export type PageChanges = ReturnType<PageChangesView['toJSON']>;

/** 블로그 메뉴 (2차 6단계): 관리자의 목록 · 메뉴 하나, 공개 메뉴 줄 */
export type MenuList = ReturnType<MenuListView['toJSON']>;
export type Menu = MenuList['menus'][number];
export type PublicMenuList = ReturnType<PublicMenuListView['toJSON']>;

/** 매거진 호 (2차 6단계): 관리자의 목록 · 호 하나(글까지) */
export type IssueList = ReturnType<IssueListView['toJSON']>;
export type Issue = IssueList['issues'][number];
export type IssueDetail = ReturnType<IssueDetailView['toJSON']>;

/** 스토어의 앱 (방문자, 스토어 1단계): 종류 · 이름 · 주소 · 설명 · 아이콘 주소. 목록은 공개 앱만 순서대로 */
export type PublicApp = ReturnType<PublicAppView['toJSON']>;
export type PublicAppList = ReturnType<PublicAppListView['toJSON']>;
/** 앱 (관리자): 칸 전부 · 든 것의 수(목록) · version. 만들거나 고친 결과는 counts가 null */
export type AdminApp = ReturnType<AppView['toJSON']>;
export type AdminAppList = ReturnType<AppListView['toJSON']>;

/** 앱 화면 하나 (스토어 1-6, 방문자): 템플릿 · 바깥 주소 · 데이터. 다른 주소로 보낼 때는 redirect만 */
export type AppScreen = ReturnType<AppScreenView['toJSON']>;
export type AppScreenRedirect = ReturnType<AppScreenRedirectView['toJSON']>;
export type AppScreenData = AppScreen['data'];
/** 앱 코드 (스토어 1-6, 관리자): 코드 탭 · 버전 한 줄 · 바뀐 점 · 미리 보기 주소 · 쓰기 결과 */
export type AppCode = ReturnType<AppCodeView['toJSON']>;
export type AppCodeVersion = AppCode['versions'][number];
export type AppCodeChanges = ReturnType<AppCodeChangesView['toJSON']>;
export type AppCodePreview = ReturnType<AppCodePreviewView['toJSON']>;
export type AppCodeState = ReturnType<AppCodeStateView['toJSON']>;
