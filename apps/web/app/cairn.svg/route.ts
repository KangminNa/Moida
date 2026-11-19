// 기본 탭 아이콘: 사이트 로고를 올리지 않았을 때 브라우저 탭에 보이는 Cairn 돌탑 표식 (_ui/CairnMark와 같은 모양).
// 밝은 탭 · 어두운 탭 모두에서 보이게 기기 설정의 어두운 모드를 따라 색을 바꾼다. 색은 globals.css의 --fg와 같다
// (탭 아이콘은 화면의 CSS 토큰을 읽을 수 없다). 표식만 보이게 둘레 여백을 잘라 16px 탭에서도 크게 보인다.
// 정적 파일(public/)이 아니라 경로로 낸다 (sw.js와 같은 까닭: 운영 이미지는 .next만 옮긴다).
export const dynamic = 'force-static';

const MARK = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="3 5 18 18">
<style>ellipse{fill:#18181b}@media (prefers-color-scheme:dark){ellipse{fill:#f4f4f5}}</style>
<ellipse cx="12" cy="19.5" rx="8" ry="2.8"/>
<ellipse cx="12" cy="13.8" rx="5.6" ry="2.5"/>
<ellipse cx="12" cy="8.6" rx="3.4" ry="2"/>
</svg>
`;

export function GET() {
  return new Response(MARK, {
    headers: {
      'content-type': 'image/svg+xml; charset=utf-8',
      'cache-control': 'public, max-age=86400',
    },
  });
}
