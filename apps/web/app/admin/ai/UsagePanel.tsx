'use client';

import { useUsage } from '../../_task/live';
import { UsageBlock } from '../../_task/UsageBlock';

// 사용량 (2차 1-5: 홈에서 설정 › AI로 옮겼다): 구독을 쓴 비율 · 남은 비율과 일꾼마다 쓴 토큰의 몫 · 한도
export function UsagePanel() {
  const usage = useUsage();
  return (
    <>
      {usage.error && <p className="error">{usage.error}</p>}
      <UsageBlock usage={usage.data} />
    </>
  );
}
