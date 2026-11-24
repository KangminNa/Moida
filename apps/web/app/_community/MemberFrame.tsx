import type { CSSProperties, ReactNode } from 'react';
import type { MemberPlace } from './member-page';

// 고정 화면의 틀 (스토어 3-2): 앱 이름(첫 화면으로) · 회원 링크와 카드 하나. 앱 코드의 모양이 아니라 Cairn이 그린다:
// 비밀번호를 넣는 화면이라 앱 코드(AI · 사람이 올린 것)가 손대지 못하게 한다.
// 앱의 테마 (스토어 12.3, 선언서의 theme): 색 셋을 CSS 변수로 덮고 로고를 이름 앞에 둔다. 값은 서버가 #rrggbb · 파일 이름으로 걸렀다

/** 테마의 색 → 이 화면의 CSS 변수 (globals.css의 토큰을 이 틀 안에서만 덮는다) */
function themeStyle(theme: MemberPlace['app']['theme']): CSSProperties | undefined {
  if (!theme) return undefined;
  const vars: Record<string, string> = {};
  if (theme.accent) vars['--accent'] = theme.accent;
  if (theme.background) {
    vars['--bg'] = theme.background;
    vars['--surface'] = theme.background;
  }
  if (theme.text) vars['--fg'] = theme.text;
  return Object.keys(vars).length > 0
    ? ({ ...vars, minHeight: '100vh' } as CSSProperties)
    : undefined;
}
export function MemberFrame({
  place,
  title,
  children,
}: {
  place: MemberPlace;
  title: string;
  children: ReactNode;
}) {
  const { app, member } = place;
  const style = themeStyle(app.theme);
  const logo = app.theme?.logo ? `/files/${encodeURIComponent(app.theme.logo)}` : null;
  return (
    <div
      className="member-theme"
      style={style ? { ...style, background: 'var(--bg)', color: 'var(--fg)' } : undefined}
    >
      <header className="blog-top">
        <a className="blog-brand" href="/">
          {logo ? (
            // biome-ignore lint/performance/noImgElement: 앱 코드의 파일이라 Next 이미지 최적화를 거치지 않는다
            <img className="member-logo" src={logo} alt="" width={24} height={24} />
          ) : null}
          {app.name}
        </a>
        <nav aria-label="회원">
          {member ? (
            <a href="/_/me">{member.nickname}</a>
          ) : (
            <>
              <a href="/_/login">로그인</a>
              <a href="/_/join">가입</a>
            </>
          )}
        </nav>
      </header>
      <main className="blog-main member-main">
        <section className="panel-card member-card" aria-label={title}>
          <h1>{title}</h1>
          {children}
        </section>
        <nav className="member-legal" aria-label="약관">
          <a href="/_/terms">이용약관</a>
          <a href="/_/privacy">개인정보처리방침</a>
        </nav>
      </main>
    </div>
  );
}
