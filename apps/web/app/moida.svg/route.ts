// 기본 탭 아이콘: 사이트 로고를 올리지 않았을 때 브라우저 탭에 보이는 Moida 표식 (_ui/MoidaMark와 같은 모양: 둘레의 점 여섯이 가운데 점으로 모인다).
// 밝은 탭 · 어두운 탭 모두에서 보이게 기기 설정의 어두운 모드를 따라 색을 바꾼다. 색은 globals.css의 --fg와 같다
// (탭 아이콘은 화면의 CSS 토큰을 읽을 수 없다). 표식만 보이게 둘레 여백을 잘라 16px 탭에서도 크게 보인다.
// 정적 파일(public/)이 아니라 경로로 낸다 (sw.js와 같은 까닭: 운영 이미지는 .next만 옮긴다).
export const dynamic = 'force-static';

const MARK = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="2 2 20 20">
<style>circle{fill:#18181b}@media (prefers-color-scheme:dark){circle{fill:#f4f4f5}}</style>
<circle cx="12" cy="4" r="1.9"/>
<circle cx="18.93" cy="8" r="1.9"/>
<circle cx="18.93" cy="16" r="1.9"/>
<circle cx="12" cy="20" r="1.9"/>
<circle cx="5.07" cy="16" r="1.9"/>
<circle cx="5.07" cy="8" r="1.9"/>
<circle cx="12" cy="12" r="3.4"/>
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
