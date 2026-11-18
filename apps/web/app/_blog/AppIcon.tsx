import { Icon } from '../_ui/Icon';
import type { PublicApp } from './types';

/** 아이콘을 올리지 않은 앱은 종류의 선 아이콘 */
const KIND_ICONS: Record<PublicApp['kind'], string> = {
  blog: 'post',
  magazine: 'book',
  page: 'site',
};

// 앱 아이콘 (스토어 1-4): 앱마다 올린 그림, 없으면 종류의 선 아이콘. size는 앱 목록의 타일 · 머리의 작은 것
export function AppIcon({ app, size }: { app: PublicApp; size: 'tile' | 'small' }) {
  return (
    <span className={`app-icon ${size}`} aria-hidden="true">
      {app.iconUrl ? (
        // biome-ignore lint/performance/noImgElement: 작은 그림 하나라 Next의 이미지 최적화를 거치지 않는다
        <img src={app.iconUrl} alt="" />
      ) : (
        <Icon name={KIND_ICONS[app.kind]} />
      )}
    </span>
  );
}
