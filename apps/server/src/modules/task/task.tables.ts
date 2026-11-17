// 자동으로 만든 파일이라 고치지 않는다. 마이그레이션 뒤 pnpm db:rows로 다시 만든다 (scripts/db-rows.mjs).
// 표 하나에 인터페이스 하나. 칼럼 이름은 DB 그대로다.
// <이름>New는 새 행에 꼭 적어야 하는 칸이고, 나머지는 DB가 채운다.

/** task.agent_revisions */
export interface AgentRevisionRow {
  id: string;
  agent_id: string;
  revision: number;
  settings: unknown;
  created_at: Date;
}
export type AgentRevisionNew = Partial<AgentRevisionRow> & Pick<AgentRevisionRow, 'id' | 'agent_id' | 'revision' | 'settings'>;

/** task.agents.tool (값 목록 CHECK) */
export const AGENT_TOOL = ['claude', 'codex'] as const;
export type AgentTool = (typeof AGENT_TOOL)[number];
/** task.agents.scopes (값 목록 CHECK) */
export const AGENT_SCOPE = ['upload', 'read_public', 'read_all', 'tidy', 'write', 'browse', 'code', 'make'] as const;
export type AgentScope = (typeof AGENT_SCOPE)[number];
/** task.agents.status (값 목록 CHECK) */
export const AGENT_STATUS = ['active', 'paused'] as const;
export type AgentStatus = (typeof AGENT_STATUS)[number];
/** task.agents.effort (값 목록 CHECK) */
export const AGENT_EFFORT = ['', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
export type AgentEffort = (typeof AGENT_EFFORT)[number];
/** task.agents */
export interface AgentRow {
  id: string;
  space_id: string;
  name: string;
  role: string;
  tool: AgentTool;
  scopes: readonly AgentScope[];
  approval_actions: readonly string[];
  monthly_limit: number | null;
  status: AgentStatus;
  version: number;
  created_at: Date;
  five_hour_limit: number | null;
  plan_stop_percent: number | null;
  reports_to: string | null;
  settings_revision: number;
  deleted_at: Date | null;
  runner_id: string | null;
  reviewer_id: string | null;
  model: string;
  effort: AgentEffort;
  external_tools: readonly string[];
}
export type AgentNew = Partial<AgentRow> & Pick<AgentRow, 'id' | 'space_id' | 'name' | 'tool'>;

/** task.ai_logins.tool (값 목록 CHECK) */
export const AI_LOGIN_TOOL = ['claude', 'codex'] as const;
export type AiLoginTool = (typeof AI_LOGIN_TOOL)[number];
/** task.ai_logins */
export interface AiLoginRow {
  id: string;
  space_id: string;
  tool: AiLoginTool;
  secret: Buffer;
  nonce: Buffer;
  expires_at: Date | null;
  checked_at: Date | null;
  last_error: string | null;
  version: number;
  created_at: Date;
}
export type AiLoginNew = Partial<AiLoginRow> & Pick<AiLoginRow, 'id' | 'space_id' | 'tool' | 'secret' | 'nonce'>;

/** task.approvals.status (값 목록 CHECK) */
export const APPROVAL_STATUS = ['pending', 'revision_requested', 'approved', 'rejected', 'cancelled'] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUS)[number];
/** task.approvals */
export interface ApprovalRow {
  id: string;
  space_id: string;
  task_id: string | null;
  agent_id: string | null;
  action: string;
  target_kind: string;
  target_id: string;
  target_version: number;
  status: ApprovalStatus;
  decided_by: string | null;
  decided_at: Date | null;
  note: string | null;
  version: number;
  created_at: Date;
  chat_id: string | null;
  card_id: string | null;
  payload: unknown | null;
}
export type ApprovalNew = Partial<ApprovalRow> & Pick<ApprovalRow, 'id' | 'space_id' | 'action' | 'target_kind' | 'target_id' | 'target_version'>;

/** task.chat_updates.kind (값 목록 CHECK) */
export const CHAT_UPDATE_KIND = ['member_done', 'member_failed', 'progress', 'decision', 'assumption', 'appended', 'reply', 'final', 'failed', 'review', 'question', 'routed'] as const;
export type ChatUpdateKind = (typeof CHAT_UPDATE_KIND)[number];
/** task.chat_updates */
export interface ChatUpdateRow {
  id: string;
  n: number;
  tx: string;
  space_id: string;
  chat_id: string;
  kind: ChatUpdateKind;
  task_id: string | null;
  agent_id: string | null;
  text: string;
  created_at: Date;
  choices: readonly string[] | null;
}
export type ChatUpdateNew = Partial<ChatUpdateRow> & Pick<ChatUpdateRow, 'id' | 'space_id' | 'chat_id' | 'kind' | 'text'>;

/** task.chats.deliver (값 목록 CHECK) */
export const CHAT_DELIVER = ['html', 'blog', 'browser', 'code'] as const;
export type ChatDeliver = (typeof CHAT_DELIVER)[number];
/** task.chats.effort (값 목록 CHECK) */
export const CHAT_EFFORT = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type ChatEffort = (typeof CHAT_EFFORT)[number];
/** task.chats */
export interface ChatRow {
  id: string;
  space_id: string;
  agent_id: string | null;
  title: string;
  turns: number;
  request_id: string;
  version: number;
  created_at: Date;
  updated_at: Date;
  device_id: string | null;
  goal: string | null;
  project: string | null;
  deliver: ChatDeliver | null;
  pending: string | null;
  model: string | null;
  effort: ChatEffort | null;
  pending_refs: unknown | null;
}
export type ChatNew = Partial<ChatRow> & Pick<ChatRow, 'id' | 'space_id' | 'title' | 'request_id'>;

/** task.external_tools.status (값 목록 CHECK) */
export const EXTERNAL_TOOL_STATUS = ['proposed', 'active', 'off'] as const;
export type ExternalToolStatus = (typeof EXTERNAL_TOOL_STATUS)[number];
/** task.external_tools */
export interface ExternalToolRow {
  id: string;
  space_id: string;
  name: string;
  title: string;
  url: string;
  header_name: string | null;
  secret: Buffer | null;
  nonce: Buffer | null;
  status: ExternalToolStatus;
  note: string;
  proposed_by: string | null;
  version: number;
  created_at: Date;
  updated_at: Date;
  catalog: unknown;
  checked_at: Date | null;
  check_error: string | null;
  last_used_at: Date | null;
  last_failed_at: Date | null;
  last_error: string | null;
}
export type ExternalToolNew = Partial<ExternalToolRow> & Pick<ExternalToolRow, 'id' | 'space_id' | 'name' | 'title' | 'url'>;

/** task.goal_rounds */
export interface GoalRoundRow {
  id: string;
  space_id: string;
  run_id: string;
  round: number;
  task_id: string;
  summary: string;
  completed: readonly string[];
  remaining: readonly string[];
  evidence: unknown;
  next_plan: string;
  done: boolean;
  milestone: boolean;
  created_at: Date;
}
export type GoalRoundNew = Partial<GoalRoundRow> & Pick<GoalRoundRow, 'id' | 'space_id' | 'run_id' | 'round' | 'task_id' | 'summary' | 'done' | 'milestone'>;

/** task.goal_runs.checkpoint (값 목록 CHECK) */
export const GOAL_RUN_CHECKPOINT = ['every', 'milestone', 'final'] as const;
export type GoalRunCheckpoint = (typeof GOAL_RUN_CHECKPOINT)[number];
/** task.goal_runs.status (값 목록 CHECK) */
export const GOAL_RUN_STATUS = ['running', 'waiting', 'done', 'stopped'] as const;
export type GoalRunStatus = (typeof GOAL_RUN_STATUS)[number];
/** task.goal_runs */
export interface GoalRunRow {
  id: string;
  space_id: string;
  goal_id: string;
  agent_id: string;
  title: string;
  instruction: string;
  criteria: readonly string[];
  checkpoint: GoalRunCheckpoint;
  round: number;
  max_rounds: number;
  status: GoalRunStatus;
  request_id: string;
  version: number;
  created_at: Date;
  finished_at: Date | null;
}
export type GoalRunNew = Partial<GoalRunRow> & Pick<GoalRunRow, 'id' | 'space_id' | 'goal_id' | 'agent_id' | 'title' | 'instruction' | 'checkpoint' | 'max_rounds' | 'status' | 'request_id'>;

/** task.goals.status (값 목록 CHECK) */
export const GOAL_STATUS = ['active', 'done', 'dropped'] as const;
export type GoalStatus = (typeof GOAL_STATUS)[number];
/** task.goals */
export interface GoalRow {
  id: string;
  space_id: string;
  parent_id: string | null;
  title: string;
  description: string;
  status: GoalStatus;
  sort: number;
  version: number;
  created_at: Date;
}
export type GoalNew = Partial<GoalRow> & Pick<GoalRow, 'id' | 'space_id' | 'title'>;

/** task.outputs.kind (값 목록 CHECK) */
export const OUTPUT_KIND = ['document', 'slides', 'sheet', 'image', 'video', 'other'] as const;
export type OutputKind = (typeof OUTPUT_KIND)[number];
/** task.outputs */
export interface OutputRow {
  id: string;
  space_id: string;
  task_id: string | null;
  run_id: string | null;
  name: string;
  kind: OutputKind;
  mime: string;
  size_bytes: number;
  blob_hash: string;
  version: number;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
  purge_after: Date | null;
  card_id: string | null;
}
export type OutputNew = Partial<OutputRow> & Pick<OutputRow, 'id' | 'space_id' | 'name' | 'kind' | 'mime' | 'size_bytes' | 'blob_hash'>;

/** task.plan_usage.tool (값 목록 CHECK) */
export const PLAN_USAGE_TOOL = ['claude', 'codex'] as const;
export type PlanUsageTool = (typeof PLAN_USAGE_TOOL)[number];
/** task.plan_usage.period (값 목록 CHECK) */
export const PLAN_USAGE_PERIOD = ['five_hour', 'seven_day'] as const;
export type PlanUsagePeriod = (typeof PLAN_USAGE_PERIOD)[number];
/** task.plan_usage.status (값 목록 CHECK) */
export const PLAN_USAGE_STATUS = ['allowed', 'allowed_warning', 'rejected'] as const;
export type PlanUsageStatus = (typeof PLAN_USAGE_STATUS)[number];
/** task.plan_usage */
export interface PlanUsageRow {
  space_id: string;
  tool: PlanUsageTool;
  period: PlanUsagePeriod;
  percent: number;
  resets_at: Date;
  status: PlanUsageStatus | null;
  seen_at: Date;
}
export type PlanUsageNew = Partial<PlanUsageRow> & Pick<PlanUsageRow, 'space_id' | 'tool' | 'period' | 'percent' | 'resets_at'>;

/** task.runners */
export interface RunnerRow {
  id: string;
  space_id: string;
  device_id: string;
  accepting: boolean;
  last_seen_at: Date;
  version: number;
  created_at: Date;
  sandbox: boolean;
}
export type RunnerNew = Partial<RunnerRow> & Pick<RunnerRow, 'id' | 'space_id' | 'device_id'>;

/** task.schedules.mode (값 목록 CHECK) */
export const SCHEDULE_MODE = ['daily', 'hourly'] as const;
export type ScheduleMode = (typeof SCHEDULE_MODE)[number];
/** task.schedules.destination (값 목록 CHECK) */
export const SCHEDULE_DESTINATION = ['task', 'chat', 'page'] as const;
export type ScheduleDestination = (typeof SCHEDULE_DESTINATION)[number];
/** task.schedules.deliver (값 목록 CHECK) */
export const SCHEDULE_DELIVER = ['html', 'blog', 'browser', 'code'] as const;
export type ScheduleDeliver = (typeof SCHEDULE_DELIVER)[number];
/** task.schedules.trigger (값 목록 CHECK) */
export const SCHEDULE_TRIGGER = ['time', 'manual', 'after'] as const;
export type ScheduleTrigger = (typeof SCHEDULE_TRIGGER)[number];
/** task.schedules */
export interface ScheduleRow {
  id: string;
  space_id: string;
  title: string;
  agent_id: string | null;
  mode: ScheduleMode;
  at_minute: number | null;
  weekdays: readonly number[];
  every_hours: number | null;
  time_zone: string;
  instruction: string;
  goal_id: string | null;
  daily_max: number;
  run_day: string | null;
  day_runs: number;
  enabled: boolean;
  next_run_at: Date | null;
  last_run_at: Date | null;
  version: number;
  created_at: Date;
  page_id: string | null;
  destination: ScheduleDestination;
  deliver: ScheduleDeliver | null;
  rules: string;
  trigger: ScheduleTrigger;
  after_id: string | null;
  chat_id: string | null;
}
export type ScheduleNew = Partial<ScheduleRow> & Pick<ScheduleRow, 'id' | 'space_id' | 'title' | 'mode' | 'time_zone'>;

/** task.skill_revisions */
export interface SkillRevisionRow {
  id: string;
  skill_id: string;
  revision: number;
  files: unknown;
  hash: string;
  based_on: string;
  note: string;
  created_at: Date;
}
export type SkillRevisionNew = Partial<SkillRevisionRow> & Pick<SkillRevisionRow, 'id' | 'skill_id' | 'revision' | 'files' | 'hash' | 'based_on'>;

/** task.skills */
export interface SkillRow {
  id: string;
  space_id: string;
  name: string;
  active_revision: number | null;
  revisions: number;
  version: number;
  created_at: Date;
  updated_at: Date;
}
export type SkillNew = Partial<SkillRow> & Pick<SkillRow, 'id' | 'space_id' | 'name'>;

/** task.task_events.kind (값 목록 CHECK) */
export const TASK_EVENT_KIND = ['read', 'write', 'result', 'error'] as const;
export type TaskEventKind = (typeof TASK_EVENT_KIND)[number];
/** task.task_events */
export interface TaskEventRow {
  id: number;
  task_id: string;
  at: Date;
  kind: TaskEventKind;
  body: string;
  tokens: number;
}
export type TaskEventNew = Partial<TaskEventRow> & Pick<TaskEventRow, 'id' | 'task_id' | 'kind'>;

/** task.task_runs.skill_source (값 목록 CHECK) */
export const TASK_RUN_SKILL_SOURCE = ['repo', 'console'] as const;
export type TaskRunSkillSource = (typeof TASK_RUN_SKILL_SOURCE)[number];
/** task.task_runs.prompt_source (값 목록 CHECK) */
export const TASK_RUN_PROMPT_SOURCE = ['repo', 'console'] as const;
export type TaskRunPromptSource = (typeof TASK_RUN_PROMPT_SOURCE)[number];
/** task.task_runs */
export interface TaskRunRow {
  id: string;
  space_id: string;
  task_id: string;
  seq: number;
  runner_id: string;
  agent_id: string | null;
  agent_revision: number | null;
  skill: string | null;
  skill_source: TaskRunSkillSource | null;
  skill_revision: number | null;
  skill_hash: string | null;
  runner_build: string | null;
  cli_version: string | null;
  model: string | null;
  started_at: Date;
  prompt_source: TaskRunPromptSource | null;
  prompt_revision: number | null;
  prompt_hash: string | null;
  lineage: string | null;
  cli_session: string | null;
  resumed: boolean | null;
}
export type TaskRunNew = Partial<TaskRunRow> & Pick<TaskRunRow, 'id' | 'space_id' | 'task_id' | 'seq' | 'runner_id'>;

/** task.tasks.status (값 목록 CHECK) */
export const TASK_STATUS = ['queued', 'running', 'waiting', 'done', 'failed', 'cancelled'] as const;
export type TaskStatus = (typeof TASK_STATUS)[number];
/** task.tasks.wait_reason (값 목록 CHECK) */
export const TASK_WAIT_REASON = ['approval', 'subtasks'] as const;
export type TaskWaitReason = (typeof TASK_WAIT_REASON)[number];
/** task.tasks */
export interface TaskRow {
  id: string;
  space_id: string;
  agent_id: string | null;
  kind: string;
  title: string;
  instruction: string;
  payload: unknown;
  result: unknown | null;
  target_kind: string | null;
  target_id: string | null;
  base_version: number | null;
  status: TaskStatus;
  priority: number;
  lease_until: Date | null;
  leased_by: string | null;
  attempts: number;
  request_id: string | null;
  version: number;
  created_at: Date;
  finished_at: Date | null;
  goal_id: string | null;
  parent_id: string | null;
  depth: number;
  wait_reason: TaskWaitReason | null;
  rounds: number;
}
export type TaskNew = Partial<TaskRow> & Pick<TaskRow, 'id' | 'space_id' | 'kind' | 'title'>;
