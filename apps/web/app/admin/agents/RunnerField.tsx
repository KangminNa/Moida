import type { RunnerChoice } from '../../_task/live';

// 에이전트 폼의 "실행 러너" 칸. 정하면 그 러너만 이 에이전트의 일을 빌린다 (서버 Agent.edit의 runner).
// 코드 · 만들기 일은 묶은 러너와 상관없이 샌드박스(코드 러너 칸)에서 돈다 (2026-11-21 팀 없는 에이전트)
export function RunnerField({
  id,
  value,
  runners,
  onChange,
}: {
  id: string;
  value: string;
  runners: readonly RunnerChoice[];
  onChange: (value: string) => void;
}) {
  return (
    <div className="field">
      <label htmlFor={id}>실행 러너</label>
      <select
        id={id}
        className="input"
        value={value}
        aria-describedby={`${id}-help`}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">아무 러너</option>
        {runners.map(({ runner, device }) => (
          <option key={runner.id} value={runner.id}>
            {device.name}
            {runner.online ? '' : ' (연결 안 됨)'}
          </option>
        ))}
      </select>
      <small id={`${id}-help`}>
        정하면 이 러너만 이 에이전트의 일을 해요 (꺼져 있으면 일이 기다려요). 코드 · 만들기는 늘
        샌드박스에서. 내 컴퓨터 러너가 나눈 폴더는 그 러너에 묶인 에이전트만 읽어요
      </small>
    </div>
  );
}
