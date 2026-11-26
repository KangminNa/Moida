'use client';

import { useEffect, useState } from 'react';
import type { SpaceInfo } from '../_account/types';
import { api } from '../_lib/client-api';
import { useAction } from '../_lib/use-action';

// 사이트 주소와 다른 주소로 콘솔을 열었을 때 (2026-11-26, 새 도메인으로 옮기는 중):
// 앱 도메인 연결 확인 · 메일 · 앱 화면의 링크는 사이트 주소를 기준으로 하므로, 지금 주소로 바꿀지 한 줄로 묻는다.
// 바꾸기는 설정 › 사이트의 저장과 같은 PUT api/space (이름 · 소개는 콘솔 틀이 읽은 값 그대로, 버전으로 낡은 저장을 막는다).
// 개발 중 localhost로 연 화면에서는 띄우지 않는다
export function SiteAddressBar({ space }: { space: SpaceInfo | null }) {
  const siteUrl = space?.siteUrl ?? null;
  const [here, setHere] = useState<string | null>(null);
  const [hidden, setHidden] = useState(false);
  const action = useAction();

  useEffect(() => setHere(location.origin), []);

  const saved = siteUrl ? new URL(siteUrl).origin : null;
  const local = here !== null && /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|$)/.test(here);
  if (!saved || !here || here === saved || local || hidden) return null;

  async function move(origin: string) {
    const reply = await action.run(
      'move',
      () =>
        api<SpaceInfo>('PUT', '/api/space', {
          name: space?.name ?? '',
          description: space?.description ?? '',
          siteUrl: origin,
          version: space?.version ?? 0,
        }),
      {
        done: '사이트 주소를 바꿨어요',
        conflict: '다른 곳에서 먼저 바뀌었어요. 화면을 새로 고친 뒤 다시 눌러 주세요',
      },
    );
    if (reply?.ok) location.reload();
  }

  return (
    <div className="toast site-moved" role="status">
      <span>사이트 주소는 {saved}예요. 앱 도메인 연결 확인 · 링크는 사이트 주소 기준이에요</span>
      <span className="site-moved-actions">
        <button type="button" disabled={action.busy !== null} onClick={() => move(here)}>
          {here}로 바꾸기
        </button>
        <button type="button" className="quiet" onClick={() => setHidden(true)}>
          닫기
        </button>
      </span>
      {action.problem && <span className="site-moved-problem">{action.problem}</span>}
    </div>
  );
}
