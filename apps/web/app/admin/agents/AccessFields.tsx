import {
  actionLabel,
  LOGIN_SITE,
  MERGE_PULL,
  PLUG_TOOL,
  PUBLISH_POST,
  PUBLISH_SITE,
} from '../../_task/labels';
import type { ExternalTool } from '../../_task/types';

/** 고를 수 있는 승인 동작: 승인 뒤 실행하는 모듈이 있는 것만. 없으면 작업이 끝나지 않는다. 한도 변경은 서버만 올린다 */
const ACTIONS = [PUBLISH_POST, PUBLISH_SITE, LOGIN_SITE, MERGE_PULL, PLUG_TOOL];
/** 새 일꾼의 처음 승인 동작: 모든 일꾼이 브라우저를 써서 러너가 이 일꾼의 이름으로 클릭 · 로그인 승인을 올린다 */
export const BROWSE_ACTIONS: readonly string[] = [PUBLISH_SITE, LOGIN_SITE];

/** 승인 동작 · 커넥터 칸의 값 */
export type Access = {
  actions: readonly string[];
  tools: readonly string[];
};

function toggled(list: readonly string[], value: string): string[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

// 에이전트 폼의 승인 요청할 수 있는 동작 · 커넥터 (2차 7단계) 칸. 값은 폼이 들고 바뀐 한 벌을 onChange로 돌려준다.
// 권한은 고르지 않는다: 모든 일꾼이 같은 권한(전부)을 가진다 (2026-11-21 팀 없는 에이전트).
export function AccessFields({
  value,
  kept,
  tools,
  onChange,
}: {
  value: Access;
  /** 이 에이전트에 이미 있는 승인 동작 (목록에 없어도 보이게) */
  kept: readonly string[];
  /** 공간의 외부 도구 */
  tools: readonly ExternalTool[];
  onChange: (next: Access) => void;
}) {
  const pick = tools.filter((t) => t.status !== 'proposed' || value.tools.includes(t.name));

  return (
    <>
      <fieldset className="checks">
        <legend>승인 요청할 수 있는 동작</legend>
        {[...new Set([...ACTIONS, ...kept])].map((a) => (
          <label key={a} className="check">
            <input
              type="checkbox"
              checked={value.actions.includes(a)}
              onChange={() => onChange({ ...value, actions: toggled(value.actions, a) })}
            />
            {actionLabel(a)}
          </label>
        ))}
      </fieldset>
      <fieldset className="checks">
        <legend>커넥터</legend>
        <small>
          이 에이전트의 일에만 붙음. 커넥터는 대화에서 붙여 달라고 하거나 설정 › 고급 › 커넥터에서
          추가
        </small>
        {pick.length === 0 && <small>커넥터 없음</small>}
        {pick.map((t) => (
          <label key={t.name} className="check">
            <input
              type="checkbox"
              checked={value.tools.includes(t.name)}
              onChange={() => onChange({ ...value, tools: toggled(value.tools, t.name) })}
            />
            {t.title}
            {t.status === 'active' ? '' : ` (${t.status === 'off' ? '꺼짐' : '제안'})`}
          </label>
        ))}
      </fieldset>
    </>
  );
}
