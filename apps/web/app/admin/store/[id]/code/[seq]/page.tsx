import { AppPreviewPanel } from './AppPreviewPanel';

export const metadata = { title: '앱 미리 보기 · Cairn', robots: { index: false } };

// 앱 코드 미리 보기 (스토어 1-6, 시안 10번): /admin/store/<앱 id>/code/<버전>. 버전은 번호 · 0(시작 코드) · live(지금 보이는 코드).
// 격리된 틀 안에서 그 버전을 공개된 것처럼 본다 (비공개 앱도). 읽기 · 공개는 패널이 한다.
export default async function AppPreviewPage({
  params,
}: {
  params: Promise<{ id: string; seq: string }>;
}) {
  const { id, seq } = await params;
  const version = /^\d{1,9}$/.test(seq) ? Number(seq) : null;
  return (
    <section className="console-inner" aria-label="앱 미리 보기">
      <AppPreviewPanel id={id} seq={version} />
    </section>
  );
}
