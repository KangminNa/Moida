import type { ReactNode } from 'react';
import type { MemberPlace } from './member-page';

// 고정 화면의 틀 (스토어 3-2): 앱 이름(첫 화면으로) · 회원 링크와 카드 하나. 앱 코드의 모양이 아니라 Cairn이 그린다:
// 비밀번호를 넣는 화면이라 앱 코드(AI · 사람이 올린 것)가 손대지 못하게 한다
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
  return (
    <>
      <header className="blog-top">
        <a className="blog-brand" href="/">
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
      </main>
    </>
  );
}
