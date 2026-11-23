import { NewTabLink } from '../../_ui/NewTabLink';

// 회차 하나의 결과 HTML 링크 (2026-11-23): 새 탭으로 보기 · 파일로 내려받기. 답이 있는 회차에만
export function ChatReportLinks({ chatId, turn }: { chatId: string; turn: number }) {
  const href = `/admin/chats/${chatId}/report?turn=${turn}`;
  return (
    <>
      {' · '}
      <NewTabLink href={href}>HTML로 보기</NewTabLink>
      {' · '}
      {/* 파일 이름(대화 제목-회차.html)은 서버의 Content-Disposition이 정한다 */}
      <a href={`/admin/chats/${chatId}/report/file?turn=${turn}`}>내려받기</a>
    </>
  );
}
