import type { CSSProperties } from 'react';
import type { ChatTeamMember } from '../../_task/types';
import { Icon } from '../../_ui/Icon';

/** 단계 순서와 화면 이름 · 아이콘 (서버 ChatTeamRow.stage의 값) */
const STAGES: readonly { key: ChatTeamMember['stage']; name: string; icon: string }[] = [
  { key: 'lease', name: '대기', icon: 'task' },
  { key: 'prepare', name: '준비', icon: 'wrench' },
  { key: 'run', name: '실행', icon: 'runner' },
  { key: 'check', name: '검사', icon: 'goal' },
  { key: 'upload', name: '올리기', icon: 'up' },
  { key: 'approve', name: '승인', icon: 'approve' },
];

// 일꾼 진행 단계 (2026-11-26 콘솔 인터랙션 1): 일꾼 줄마다 대기 → 준비 → 실행 → 검사 → 올리기 → 승인을 아이콘으로 잇고,
// 지난 단계는 채우고 지금 단계는 숨 쉬듯 깜빡인다. 단계는 서버가 정한다 (ChatQuery.team). 움직임 줄이기면 깜빡이지 않는다 (globals.css)
export function LaneStages({ stage }: { stage: ChatTeamMember['stage'] }) {
  const at = STAGES.findIndex((s) => s.key === stage);
  return (
    <ol
      className="lane-stages"
      aria-label={`지금 단계: ${STAGES[at]?.name ?? ''}`}
      // 채운 선의 길이 (첫 단계 0 → 마지막 단계 1, ::after가 그린다)
      style={{ '--done': Math.max(at, 0) / (STAGES.length - 1) } as CSSProperties}
    >
      {STAGES.map((s, i) => (
        <li key={s.key} className={i < at ? 'done' : i === at ? 'now' : undefined} title={s.name}>
          <span className="lane-stage-dot">
            <Icon name={s.icon} />
          </span>
          <span className="lane-stage-name">{s.name}</span>
        </li>
      ))}
    </ol>
  );
}
