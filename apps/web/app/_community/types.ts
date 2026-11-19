import type {
  MemberMeView,
  MemberSelfView,
} from '../../../server/src/modules/community/member/member.view';
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
