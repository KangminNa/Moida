import Link from 'next/link';
import { engineLabel, holdLabel, share, tokens, WINDOW_LABELS, when } from './labels';
import { useEngines } from './live';
import type { Usage, UsageAgent, UsageWindow } from './types';

/** 초기화까지 남은 때: "3일 4시간 뒤", "2시간 10분 뒤", "10분 뒤" */
function until(iso: string, now: number): string {
  const minutes = Math.max(1, Math.ceil((new Date(iso).getTime() - now) / 60_000));
  if (minutes < 60) return `${minutes}분 뒤`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 ${minutes % 60}분 뒤`;
  return `${Math.floor(hours / 24)}일 ${hours % 24}시간 뒤`;
}

/**
 * 값 한 줄과 막대, 그 아래 덧붙이는 말. 글자가 값을 말하므로 막대는 읽어 주지 않는다.
 * part면 막대가 한도가 아니라 전체에서의 몫이다 (옅은 막대)
 */
function Meter({
  label,
  value,
  percent,
  hint,
  full = false,
  part = false,
}: {
  label: string;
  value: string;
  percent: number;
  hint?: string;
  full?: boolean;
  part?: boolean;
}) {
  return (
    <div className="usage">
      <div className="usage-text">
        <span>{label}</span>
        <span className={full ? 'mono strong' : 'mono'}>{value}</span>
      </div>
      <div className={part ? 'bar part' : 'bar'} aria-hidden="true">
        <i style={{ width: `${Math.min(100, percent)}%` }} />
      </div>
      {hint && <small className="usage-hint">{hint}</small>}
    </div>
  );
}

/** 구독 창 하나: 쓴 비율과 남은 비율, 언제 초기화되는지. 값이 없거나 초기화 시각이 지났으면 확인 전 */
function PlanMeter({ row, now }: { row: UsageWindow; now: number }) {
  const label = WINDOW_LABELS[row.window] ?? row.window;
  if (row.percent === null || row.resetsAt === null)
    return <Meter label={label} value="확인 전" percent={0} hint="일을 한 번 하면 보여요" />;
  const left = Math.max(0, 100 - row.percent);
  return (
    <Meter
      label={label}
      value={`${row.percent}% 사용 · ${left}% 남음`}
      percent={row.percent}
      full={row.percent >= 100}
      hint={`${when(row.resetsAt)} 초기화 (${until(row.resetsAt, now)})${
        row.seenAt ? ` · ${when(row.seenAt)} 확인` : ''
      }`}
    />
  );
}

/** 토큰 한 줄. 한도가 있으면 한도에서의 비율, 없으면 모든 일꾼이 쓴 것에서의 몫 */
function TokenMeter({
  label,
  used,
  limit,
  total,
}: {
  label: string;
  used: number;
  limit: number | null;
  total: number;
}) {
  if (limit === null)
    return (
      <Meter
        label={label}
        value={`${tokens(used)} 토큰 · 전체의 ${share(used, total)}`}
        percent={total > 0 ? (used / total) * 100 : 0}
        part
      />
    );
  return (
    <Meter
      label={label}
      value={`${tokens(used)} / ${tokens(limit)} 토큰 · ${share(used, limit)}`}
      percent={(used / limit) * 100}
      full={used >= limit}
    />
  );
}

const nameOf = (row: UsageAgent) => (row.lead ? `${row.name} (대표)` : row.name);
const sum = (rows: readonly UsageAgent[], pick: (row: UsageAgent) => number) =>
  rows.reduce((all, row) => all + pick(row), 0);

function AgentMeters({ row, month, recent }: { row: UsageAgent; month: number; recent: number }) {
  const hold = holdLabel(row);
  return (
    <li className="usage-agent">
      <div className="usage-head">
        <b>{nameOf(row)}</b>
        {hold && <span className="pill strong">{hold}</span>}
      </div>
      <TokenMeter label="이번 달" used={row.monthTokens} limit={row.monthlyLimit} total={month} />
      <TokenMeter
        label="최근 5시간"
        used={row.fiveHourTokens}
        limit={row.fiveHourLimit}
        total={recent}
      />
      {row.planStopPercent !== null && (
        <small className="usage-hint">구독 사용률 {row.planStopPercent}%부터 쉬기</small>
      )}
    </li>
  );
}

// 사용량 (설정 › AI): 구독을 얼마나 썼고 얼마나 남았는지, 누가 얼마나 썼는지.
// 많이 쓴 순서로 보여 주고, 이번 달에 쓰지 않았고 한도도 없는 일꾼은 이름만 한 줄로 모은다.
// 상태는 굵기와 채움으로만 구분한다.
export function UsageBlock({ usage }: { usage: Usage | null }) {
  const engines = useEngines();
  const now = Date.now();
  const tools = [...new Set(usage?.plan.map((row) => row.tool))];
  const rows = usage?.agents ?? [];
  const month = sum(rows, (row) => row.monthTokens);
  const recent = sum(rows, (row) => row.fiveHourTokens);
  const quiet = (row: UsageAgent) =>
    row.monthTokens === 0 &&
    row.monthlyLimit === null &&
    row.fiveHourLimit === null &&
    row.planStopPercent === null &&
    !row.holding;
  const shown = rows.filter((row) => !quiet(row)).sort((a, b) => b.monthTokens - a.monthTokens);
  const unused = rows.filter(quiet);
  return (
    <section aria-labelledby="home-usage">
      <header className="page-head">
        <h2 id="home-usage">사용량</h2>
        <Link className="text-button" href="/admin/agents">
          한도 설정
        </Link>
      </header>
      {usage === null ? (
        <p className="label-mono loading">불러오는 중…</p>
      ) : rows.length === 0 ? (
        <p className="rows-empty">아직 없음. 대화에서 일을 맡기면 여기에 쌓여요</p>
      ) : (
        <div className="usage-cols">
          <div className="panel">
            {tools.map((tool) => (
              <div key={tool} className="usage-agent">
                <div className="usage-head">
                  <b>{engineLabel(engines, tool)} 구독</b>
                </div>
                {usage.plan
                  .filter((row) => row.tool === tool)
                  .map((row) => (
                    <PlanMeter key={row.window} row={row} now={now} />
                  ))}
              </div>
            ))}
          </div>
          <ul className="panel usage-agents">
            <li className="usage-agent">
              <div className="usage-head">
                <b>모든 일꾼</b>
                <span className="mono">
                  이번 달 {tokens(month)} 토큰 · 최근 5시간 {tokens(recent)} 토큰
                </span>
              </div>
            </li>
            {shown.map((row) => (
              <AgentMeters key={row.id} row={row} month={month} recent={recent} />
            ))}
            {unused.length > 0 && (
              <li className="usage-agent">
                <small className="usage-hint">
                  이번 달에 쓰지 않음 {unused.length}: {unused.map(nameOf).join(' · ')}
                </small>
              </li>
            )}
          </ul>
        </div>
      )}
    </section>
  );
}
