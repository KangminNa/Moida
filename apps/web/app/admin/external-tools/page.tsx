import { ExternalToolPanel } from './ExternalToolPanel';

export const metadata = { title: '외부 도구 · Cairn', robots: { index: false } };

// 외부 도구 메뉴 (2차 7단계). 페이지는 틀만 두고, 읽기·쓰기는 클라이언트 패널이 서버 API로 한다.
export default function ExternalToolPage() {
  return (
    <section className="console-inner narrow" aria-label="외부 도구">
      <ExternalToolPanel />
    </section>
  );
}
