import type { ReactNode } from 'react';

// 플러그인 화면이 받는 값. 자리마다 context가 정해져 있다.
//   post.after: 글 아래 — 글 id, 주소, 제목
//   task.office: 콘솔의 오피스 — 넘기는 값 없음
//   store.after: 스토어 첫 화면 아래 — 공개 앱(주소 · 이름)과 주소의 mail · token (메일 링크로 왔을 때, 2026-11-26)
export type SlotContext =
  | { postId: string; slug: string; title: string; preview?: boolean }
  | {
      apps: readonly { slug: string; name: string }[];
      mail: string | null;
      token: string | null;
    }
  | Record<string, never>;
export type SlotProps = { settings: Record<string, string>; context: SlotContext };
/** 메서드 꼴로 둔다: 화면마다 자기 자리의 context만 받아도 들어갈 수 있게 (속성 꼴은 매개변수를 엄격하게 비교한다) */
export type SlotEntry = { plugin: string; Component(props: SlotProps): ReactNode };
