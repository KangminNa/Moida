import { AppIcon } from './AppIcon';
import type { PublicApp } from './types';

// 스토어 가입 (2026-11-26, 사용자 "스토어 가입을 넣고 회원가입 페이지 따로 만들어줘"): 스토어 첫 화면의 "가입하기"는 스토어의 가입 화면
// /join으로 간다. 계정은 이 사이트(스토어)에 하나라 어느 앱에서나 같은 계정으로 로그인한다. 로그인(회원 쿠키)은 연결을 확인한
// 앱 도메인에서만 열려(콘솔과 같은 출처에 회원 쿠키를 두지 않는다, 스토어 11장) 가입 뒤에는 앱을 골라 그 앱에서 로그인한다.

/** 가입 뒤 로그인할 수 있는 앱: 회원을 받고 자기 도메인으로 열리는 앱 */
export function joinableApps(apps: readonly PublicApp[]): PublicApp[] {
  return apps.filter((a) => a.members && /^https?:\/\//.test(a.url));
}

/** 가입하기 버튼이 갈 곳: 로그인할 앱이 있으면 스토어의 가입 화면, 없으면 없음 (가입해도 쓸 곳이 없다) */
export function joinHref(apps: readonly PublicApp[]): string | null {
  return apps.length > 0 ? '/join' : null;
}

/** 그 앱의 로그인 화면 주소 */
export function appLoginUrl(app: PublicApp): string {
  return new URL('/_/login', app.url).toString();
}

/** 가입한 계정으로 로그인할 앱 목록 (가입 화면의 끝 · 가입 뒤) */
export function StoreAppLogins({ apps }: { apps: readonly PublicApp[] }) {
  return (
    <ul className="store-join">
      {apps.map((a) => (
        <li key={a.slug}>
          <a href={appLoginUrl(a)}>
            <AppIcon app={a} size="tile" />
            <strong>{a.name}</strong>
            <span className="store-arrow" aria-hidden="true">
              →
            </span>
          </a>
        </li>
      ))}
    </ul>
  );
}
