import type {
  AppRowsView,
  AppTablesView,
} from '../../../server/src/modules/community/data/app-data.view';
import type {
  MemberMeView,
  MemberSelfView,
} from '../../../server/src/modules/community/member/member.view';
import type {
  AdminMemberView,
  AdminPageView,
  AdminReportView,
  AdminTopicLineView,
  AdminTopicView,
  DecisionView,
  MemberResetView,
} from '../../../server/src/modules/community/moderation/moderation.view';
import type {
  TopicListView,
  TopicSavedView,
  TopicView,
} from '../../../server/src/modules/community/topic/topic.view';

// 커뮤니티의 응답 모양 (스토어 3-2). 서버 view에서 만든다 (web 규칙: 손으로 적지 않는다)

/** GET /api/community/me: 이 브라우저의 회원 (없으면 null)과 쓰기 확인 값 */
export type MemberMe = ReturnType<MemberMeView['toJSON']>;
export type MemberSelf = ReturnType<MemberSelfView['toJSON']>;
/** GET /api/community/topics */
export type TopicList = ReturnType<TopicListView['toJSON']>;
/** GET /api/community/topics/:id (보이는 댓글과 함께) */
export type TopicDetail = ReturnType<TopicView['toJSON']>;
export type TopicSaved = ReturnType<TopicSavedView['toJSON']>;

// 관리자 화면 (앱 관리의 커뮤니티 탭, 3-1c 관리 API)

/** 관리 목록 한 쪽 */
type AdminPage<V extends { toJSON(): object }> = ReturnType<AdminPageView<V>['toJSON']>;
export type AdminTopicPage = AdminPage<AdminTopicLineView>;
export type AdminTopicLine = AdminTopicPage['items'][number];
export type AdminTopic = ReturnType<AdminTopicView['toJSON']>;
export type AdminReportPage = AdminPage<AdminReportView>;
export type AdminReport = AdminReportPage['items'][number];
export type AdminMemberPage = AdminPage<AdminMemberView>;
export type AdminMember = AdminMemberPage['items'][number];
export type DecisionPage = AdminPage<DecisionView>;
/** 비밀번호 초기화의 답: 임시 비밀번호는 이 응답에만 */
export type MemberReset = ReturnType<MemberResetView['toJSON']>;

// 앱 데이터 (앱 플랫폼, 스토어 12.4): 앱 관리의 데이터 탭

/** GET /api/community/admin/:appId/data: 앱이 선언한 표와 줄 수 */
export type AppTableList = ReturnType<AppTablesView['toJSON']>;
export type AppTableLine = AppTableList['tables'][number];
/** GET /api/community/admin/:appId/data/:table: 줄 (관리자에게는 쓴 회원까지) */
export type AppRowPage = ReturnType<AppRowsView['toJSON']>;
