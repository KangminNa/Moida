import { SCOPE_LABELS } from '../../_lib/types';
import {
  actionLabel,
  LOGIN_SITE,
  MERGE_PULL,
  PLUG_TOOL,
  PUBLISH_POST,
  PUBLISH_SITE,
} from '../../_task/labels';
import type { ExternalTool } from '../../_task/types';

/** 에이전트에게 줄 수 있는 권한. run은 러너의 것이라 없다 (서버의 Agent.SCOPES와 맞춘다) */
const SCOPES = ['upload', 'read_public', 'read_all', 'tidy', 'write', 'browse', 'code', 'make'];
/** 고를 수 있는 결재 동작: 승인 뒤 실행하는 모듈이 있는 것만. 없으면 작업이 끝나지 않는다. 한도 변경은 서버만 올린다 */
const ACTIONS = [PUBLISH_POST, PUBLISH_SITE, LOGIN_SITE, MERGE_PULL, PLUG_TOOL];
/** 브라우저 사용을 켜면 함께 켜는 결재 동작: 러너가 이 에이전트의 이름으로 클릭 · 로그인 결재를 올린다 */
const BROWSE_ACTIONS = [PUBLISH_SITE, LOGIN_SITE];
/** 외부 도구와 함께 줄 수 없는 권한 (서버 AgentScopes.NOT_WITH_TOOLS와 맞춘다): 비공개를 열거나 셸이 있는 것 */
const NOT_WITH_TOOLS = ['read_all', 'write', 'code', 'make'];

/** 권한 · 결재 동작 · 외부 도구 칸의 값 */
export type Access = {
  scopes: readonly string[];
  actions: readonly string[];
  tools: readonly string[];
};

function toggled(list: readonly string[], value: string): string[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

// 에이전트 폼의 권한 · 결재 요청할 수 있는 동작 · 외부 도구 (2차 7단계) 칸. 값은 폼이 들고 바뀐 한 벌을 onChange로 돌려준다.
// 외부 도구는 비공개를 읽거나 셸이 있는 에이전트에 붙이지 않는다: 그 권한을 켜면 고른 도구를 뺀다 (서버도 422로 막는다).
export function AccessFields({
  value,
  kept,
  tools,
  onChange,
}: {
  value: Access;
  /** 이 에이전트에 이미 있는 결재 동작 (목록에 없어도 보이게) */
  kept: readonly string[];
  /** 공간의 외부 도구 */
  tools: readonly ExternalTool[];
  onChange: (next: Access) => void;
}) {
  const closed = value.scopes.some((s) => NOT_WITH_TOOLS.includes(s));
  const pick = tools.filter((t) => t.status !== 'proposed' || value.tools.includes(t.name));

  function scope(s: string) {
    const scopes = toggled(value.scopes, s);
    const actions =
      s === 'browse' && scopes.includes(s)
        ? [...new Set([...value.actions, ...BROWSE_ACTIONS])]
        : value.actions;
    const shut = scopes.some((x) => NOT_WITH_TOOLS.includes(x));
    onChange({ scopes, actions, tools: shut ? [] : value.tools });
  }

  return (
    <>
      <fieldset className="checks">
        <legend>권한</legend>
        <small>
          세션 정리는 정리와 전체 읽기 권한이 함께 필요. 브라우저 사용 · 코드 작업 · 파일 만들기 ·
          외부 도구는 전체 읽기 · 초안 작성과 함께 줄 수 없음
        </small>
        {SCOPES.map((s) => (
          <label key={s} className="check">
            <input type="checkbox" checked={value.scopes.includes(s)} onChange={() => scope(s)} />
            {SCOPE_LABELS[s]}
          </label>
        ))}
      </fieldset>
      <fieldset className="checks">
        <legend>결재 요청할 수 있는 동작</legend>
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
      <fieldset className="checks" disabled={closed}>
        <legend>외부 도구</legend>
        <small>
          {closed
            ? '전체 읽기 · 초안 작성 · 코드 작업 · 파일 만들기 권한에는 붙이지 않음'
            : '이 에이전트의 일에만 붙음. 도구는 설정 › 외부 도구에서 추가'}
        </small>
        {pick.length === 0 && <small>외부 도구 없음</small>}
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
