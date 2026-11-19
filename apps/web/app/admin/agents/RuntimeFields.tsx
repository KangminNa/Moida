import { EFFORT_LABELS } from '../../_task/labels';
import { useEngines } from '../../_task/live';

/** 모델 · 생각 강도 칸의 값 (빈 글이면 CLI의 기본) */
export type Runtime = { model: string; effort: string };

/**
 * 도구를 바꾸면 그 도구가 받지 않는 강도는 기본으로 되돌린다 (서버 AgentRuntime.assertFits도 막는다).
 * efforts: 새 도구가 받는 강도 (엔진 목록)
 */
export function runtimeFor(efforts: readonly string[], runtime: Runtime): Runtime {
  return efforts.includes(runtime.effort) ? runtime : { ...runtime, effort: '' };
}

// 에이전트 폼의 "모델" · "생각 강도" 칸 (2차 7단계). 비워 두면 AI CLI가 정한 기본으로 돈다.
// 실제로 돈 모델은 작업의 실행 기록에 남는다.
export function RuntimeFields({
  id,
  tool,
  value,
  onChange,
}: {
  id: string;
  /** 이 에이전트의 AI 도구 (받는 강도가 다르다) */
  tool: string;
  value: Runtime;
  onChange: (value: Runtime) => void;
}) {
  const efforts = useEngines().find((e) => e.name === tool)?.efforts ?? [];
  return (
    <>
      <div className="field">
        <label htmlFor={`${id}-model`}>모델</label>
        <input
          id={`${id}-model`}
          className="input"
          value={value.model}
          maxLength={80}
          pattern="[A-Za-z0-9._\[\]\-]+"
          placeholder="기본"
          aria-describedby={`${id}-model-help`}
          onChange={(e) => onChange({ ...value, model: e.target.value })}
        />
        <small id={`${id}-model-help`}>
          비우면 AI 도구의 기본 모델. 예: opus · sonnet · gpt-5. 맡겨 받은 일은 맡긴 쪽 모델 이하로
        </small>
      </div>
      <div className="field">
        <label htmlFor={`${id}-effort`}>생각 강도</label>
        <select
          id={`${id}-effort`}
          className="input"
          value={value.effort}
          onChange={(e) => onChange({ ...value, effort: e.target.value })}
        >
          <option value="">기본</option>
          {efforts.map((effort) => (
            <option key={effort} value={effort}>
              {EFFORT_LABELS[effort] ?? effort}
            </option>
          ))}
        </select>
      </div>
    </>
  );
}
