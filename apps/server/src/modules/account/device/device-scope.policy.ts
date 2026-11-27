import { Actor } from '../../platform';
import type { DeviceRow } from '../account.tables';

// 새 기기가 받는 권한 (2026-11-27 device.ts에서 나눔): 앱이 요청한 기기 모양(PROFILES), 관리자가 승인 화면에서 고른 묶음(PRESETS),
// 둘 다 없으면 기본(DEFAULT). 연결 뒤 넓히기 · 좁히기는 관리자가 기기 메뉴에서 한다 (Device.edit)
export class DeviceScopes {
  /** 새 기기의 기본 권한: 올리기 + 공개 읽기. 나머지는 관리 화면에서 켠다 (승인 화면에서 권한 묶음을 고르지 않았을 때) */
  static readonly DEFAULT: DeviceRow['scopes'] = [Actor.UPLOAD, Actor.READ_PUBLIC];
  /**
   * 승인 화면에서 고르는 권한 묶음 (2026-11-27, 사용자 "MCP의 역할이 너무 약해진 것 같다"). 앱이 기기 모양(PROFILES)을
   * 요청하지 않은 연결만 고른다. 화면은 업무용을 먼저 골라 둔다.
   *   record: 기록만 (세션 저장 · 공개 읽기, 지금까지의 기본)
   *   work: 업무용 (+ 비공개 읽기 · 초안 쓰기 · 대표에게 맡기기 · 승인 대기 보기)
   *   all: 전부 (+ 세션 정리). 일 빌리기(run)는 러너만이라 어느 묶음에도 없다
   */
  static readonly PRESETS: Readonly<Record<string, DeviceRow['scopes']>> = {
    record: [Actor.UPLOAD, Actor.READ_PUBLIC],
    work: [Actor.UPLOAD, Actor.READ_ALL, Actor.WRITE, Actor.DELEGATE, Actor.INBOX],
    all: [Actor.UPLOAD, Actor.READ_ALL, Actor.TIDY, Actor.WRITE, Actor.DELEGATE, Actor.INBOX],
  };
  /**
   * 앱이 승인 요청의 scope에 이름 하나를 실어 고르는 기기 모양 (이름 → 권한). 섞어 요청하지 못한다 (AuthorizationPolicy).
   *   news: 소식 기기 (2차 1-3, cairn connect의 훅 · 상태 줄). 다른 권한과 함께 두지 않아 관리자가 주거나 바꾸지 못한다
   *     (ALL_SCOPES에 없음, DB CHECK devices_news_only)
   *   collect: 수집 기기 (2차 4단계, 세션이 끝날 때 원문을 올리는 훅). 올리기만
   *   extension: 브라우저 확장 (2차 4단계). 원문 · 페이지 올리기, 서버 팀에 맡기기, 기다리는 결재 · 질문 보기
   *   deploy: 배포 기기 (앱 플랫폼, 스토어 12.5, cairn app deploy). 쓰기만: 앱 코드의 새 버전을 올린다
   *     (공개 앱의 새 버전은 관리자가 확인해야 보인다)
   */
  static readonly PROFILES: Readonly<Record<string, DeviceRow['scopes']>> = {
    news: [Actor.NEWS],
    collect: [Actor.UPLOAD],
    extension: [Actor.UPLOAD, Actor.DELEGATE, Actor.INBOX],
    deploy: [Actor.WRITE],
  };

  /** 앱이 요청한 기기 모양이 있으면 그 권한, 없으면 관리자가 고른 묶음(PRESETS), 그것도 없으면 기본 권한 */
  static of(
    requested: readonly string[] | null,
    preset: string | null = null,
  ): DeviceRow['scopes'] {
    const profile = DeviceScopes.profileOf(requested);
    if (profile) return profile;
    return (preset !== null && DeviceScopes.PRESETS[preset]) || DeviceScopes.DEFAULT;
  }

  /** 앱이 요청한 기기 모양(PROFILES의 이름 하나)의 권한. 없거나 모르는 이름이면 null */
  static profileOf(requested: readonly string[] | null): DeviceRow['scopes'] | null {
    const [name] = requested ?? [];
    return (requested?.length === 1 && name && DeviceScopes.PROFILES[name]) || null;
  }
}
