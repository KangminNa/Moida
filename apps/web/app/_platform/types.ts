import type { FailedEventListView } from '../../../server/src/modules/platform/failed-event/failed-event.view';
import type {
  LibraryPageView,
  LibraryTrashedView,
} from '../../../server/src/modules/platform/library/library.view';
import type { NoticeSettingsView } from '../../../server/src/modules/platform/notice/notice-settings.view';
import type { NotificationListView } from '../../../server/src/modules/platform/notice/notification.view';
import type {
  PushKeyView,
  PushTestView,
} from '../../../server/src/modules/platform/notice/push.view';
import type {
  PluginActionResultView,
  PluginListView,
  PluginSettingsView,
  PluginSettingView,
  PluginView,
} from '../../../server/src/modules/platform/plugin/plugin.view';
import type { SecurityEventPageView } from '../../../server/src/modules/platform/security/security-event.view';

// 서버가 돌려주는 모양 (platform). 서버 코드가 웹 번들에 들어가지 않게 import type으로만 가져온다.

export type NotificationList = ReturnType<NotificationListView['toJSON']>;
export type Notification = NotificationList['notifications'][number];
export type NoticeSettings = ReturnType<NoticeSettingsView['toJSON']>;
export type NoticeKindSetting = NoticeSettings['kinds'][number];
export type PushKey = ReturnType<PushKeyView['toJSON']>;
export type PushTest = ReturnType<PushTestView['toJSON']>;
/** 주인이 보는 플러그인 하나 (플러그인 메뉴, 설치 마법사) */
export type Plugin = ReturnType<PluginView['toJSON']>;
export type PluginList = ReturnType<PluginListView['toJSON']>;
export type PluginSetting = ReturnType<PluginSettingView['toJSON']>;
/** 관리 동작의 결과 (예: 연결 확인) */
export type PluginActionResult = ReturnType<PluginActionResultView['toJSON']>;
/** 보관함 한 쪽 (2차 5단계): 결과물 · 페이지 · 읽은 글 · 세션 · 위키 · 글, 최근 것부터 */
export type LibraryPage = ReturnType<LibraryPageView['toJSON']>;
export type LibraryTrashed = ReturnType<LibraryTrashedView['toJSON']>;
/** 보안 기록 한 쪽 (설정 › 보안, 최근부터) */
export type SecurityEventPage = ReturnType<SecurityEventPageView['toJSON']>;
export type SecurityEvent = SecurityEventPage['events'][number];
/** 8번 실패해 멈춘 이벤트 (설정 › 일 › 처리 실패, 리팩토링 R1) */
export type FailedEventList = ReturnType<FailedEventListView['toJSON']>;
export type FailedEvent = FailedEventList['items'][number];

/** 켜진 플러그인 하나의 공개 설정 (GET /api/plugins/<이름>/settings: 화면 자리 · 지도 플러그인) */
export type PluginPublicSettings = ReturnType<PluginSettingsView['toJSON']>;
