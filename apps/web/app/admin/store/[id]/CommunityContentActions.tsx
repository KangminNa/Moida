'use client';

import type { AdminTopic } from '../../../_community/types';
import { api } from '../../../_lib/client-api';
import type { Action } from '../../../_lib/use-action';

type TopicState = AdminTopic['state'];

/** 상태마다 내릴 수 있는 결정 (서버 Moderation.next와 같은 규칙): [동작, 단추 이름] */
const CHOICES: Record<TopicState, readonly ['hide' | 'show' | 'remove', string][]> = {
  shown: [
    ['show', '신고 기각'],
    ['hide', '가림'],
    ['remove', '내림'],
  ],
  hidden: [
    ['show', '되돌림'],
    ['remove', '내림'],
  ],
  removed: [['show', '되돌림']],
  deleted: [],
};

const CONFLICT = '그사이 바뀌었어요. 다시 읽었어요';

// 글 · 댓글 하나에 내리는 관리자 결정 단추 (신고 · 글 화면이 함께 쓴다). 되돌림 · 신고 기각은 열린 신고를 기각하고,
// 가림 · 내림은 인정한다. 메모는 회원에게 보이지 않고 결정 기록에 남는다. 동작은 부르는 패널의 useAction으로 돈다
export function CommunityContentActions({
  appId,
  kind,
  id,
  state,
  version,
  action,
  reload,
}: {
  appId: string;
  kind: 'topic' | 'comment';
  id: string;
  state: TopicState;
  version: number;
  action: Action;
  reload: () => unknown;
}) {
  const choices = CHOICES[state];
  if (choices.length === 0) return null;

  function decide(value: 'hide' | 'show' | 'remove', label: string) {
    const note = window.prompt(`${label}: 메모 (선택, 결정 기록에만 남아요)`, '');
    if (note === null) return;
    const path = `/api/community/admin/${appId}/${kind === 'topic' ? 'topics' : 'comments'}/${id}/decide`;
    void action.run(`${id}:${value}`, () => api('POST', path, { version, action: value, note }), {
      done: `${label} 함`,
      reload,
      conflict: CONFLICT,
    });
  }

  return (
    <span className="row">
      {choices.map(([value, label]) => (
        <button
          key={value}
          type="button"
          className={value === 'remove' ? 'ghost small danger' : 'ghost small'}
          disabled={action.busy !== null}
          onClick={() => decide(value, label)}
        >
          {action.busy === `${id}:${value}` ? '하는 중' : label}
        </button>
      ))}
    </span>
  );
}
