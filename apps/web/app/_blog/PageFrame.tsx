import { pagePath } from './format';
import type { PublicPageList } from './types';

/** 페이지의 스크립트는 콘솔과 로그인에 닿지 못한다 (서버의 격리 머리글과 같다) */
const FRAME_SANDBOX =
  'allow-scripts allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-downloads';

// AI가 만든 페이지 하나를 격리된 틀로 (페이지 하나 메뉴, 페이지 앱의 첫 화면)
export function PageFrame({ page }: { page: PublicPageList['pages'][number] }) {
  return (
    <iframe
      className="menu-frame"
      title={page.title}
      src={`${pagePath(page.name)}/index.html`}
      sandbox={FRAME_SANDBOX}
    />
  );
}
