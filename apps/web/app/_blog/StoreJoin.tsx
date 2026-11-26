import { AppIcon } from './AppIcon';
import type { PublicApp } from './types';

// 스토어 첫 화면의 가입 (2026-11-26, 사용자 "가입하기 버튼도 넣어줘"): 계정은 이 사이트(스토어)에 하나라 어느 앱에서 가입해도
// 모든 앱에서 같은 계정으로 로그인한다. 회원 화면(/_/join)은 연결을 확인한 앱 도메인에서만 열려(콘솔과 같은 출처에 회원 쿠키를
// 두지 않는다, 스토어 11장) 회원을 받고(members) 바깥 주소가 도메인인 앱만 고른다.

/** 가입할 수 있는 앱: 회원을 받고 자기 도메인으로 열리는 앱 */
export function joinableApps(apps: readonly PublicApp[]): PublicApp[] {
  return apps.filter((a) => a.members && /^https?:\/\//.test(a.url));
}

/** 그 앱의 가입 화면 주소 */
export function joinUrl(app: PublicApp): string {
  return new URL('/_/join', app.url).toString();
}

/** 가입하기 버튼이 갈 곳: 앱이 하나면 그 앱의 가입 화면, 여럿이면 고르는 칸 */
export function joinHref(apps: readonly PublicApp[]): string | null {
  const [only, ...rest] = apps;
  if (!only) return null;
  return rest.length === 0 ? joinUrl(only) : '#join';
}

/** 앱이 둘 이상일 때 가입할 앱을 고르는 칸 */
export function StoreJoin({ apps }: { apps: readonly PublicApp[] }) {
  if (apps.length < 2) return null;
  return (
    <section className="store-band" id="join" aria-labelledby="store-join">
      <div className="store-band-head">
        <h2 id="store-join">가입하기</h2>
        <span>계정 하나로 모든 앱</span>
      </div>
      <p className="store-desc store-join-note">
        한 곳에서 가입하면 다른 앱에서는 같은 메일 · 아이디로 로그인하고 닉네임만 정해 참여해요
      </p>
      <ul className="store-join">
        {apps.map((a) => (
          <li key={a.slug}>
            <a href={joinUrl(a)}>
              <AppIcon app={a} size="tile" />
              <strong>{a.name}</strong>
              <span className="store-arrow" aria-hidden="true">
                →
              </span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
