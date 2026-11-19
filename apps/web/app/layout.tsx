import type { ReactNode } from 'react';
import type { SpaceInfo } from './_account/types';
import { serverGet } from './_lib/server-api';
import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css';
import './globals.css';
import { NewTabLink } from './_ui/NewTabLink';
import { SOURCE_URL } from './_ui/source';
import { PAGE_FLIP_SCRIPT } from './admin/page-flip';

/** 로고를 올리지 않았을 때의 탭 아이콘 (cairn.svg/route.ts) */
const CAIRN_ICON = '/cairn.svg';

/** 사이트 로고를 올렸으면 브라우저 탭 아이콘으로도 쓴다. 없으면 Cairn 표식 */
export async function generateMetadata() {
  const space = await serverGet<SpaceInfo>('/api/space', true);
  return {
    title: 'Cairn',
    description: '내 서버에서 도는 Personal AI OS. AI 세션, 작업, 블로그를 한곳에서',
    icons: { icon: space?.logoUrl ?? CAIRN_ICON },
  };
}

// AGPL-3.0: 서비스를 쓰는 사람도 소스를 받을 수 있게 모든 화면에 링크를 둔다

// 고른 테마 · 글자 크기를 첫 그림 전에 적용한다 (고르지 않았으면 기기 설정 · 보통)
const THEME_SCRIPT =
  "try{var d=document.documentElement,t=localStorage.getItem('cairn-theme'),x=localStorage.getItem('cairn-text');if(t==='light'||t==='dark')d.dataset.theme=t;if(x==='small'||x==='large')d.dataset.text=x}catch(e){}";

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <head>
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: 고정된 문자열, 입력값 없음 */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: 메뉴 파일의 주소로만 만든 고정 문자열, 입력값 없음 */}
        <script dangerouslySetInnerHTML={{ __html: PAGE_FLIP_SCRIPT }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500&display=swap"
        />
      </head>
      <body>
        {children}
        <NewTabLink className="source" href={SOURCE_URL}>
          소스 · AGPL-3.0
        </NewTabLink>
      </body>
    </html>
  );
}
