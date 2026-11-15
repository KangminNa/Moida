import type {
  ClickDetailView,
  ShotImageView,
  ShotListView,
} from '../../../../plugins/browser-tabs/server/click-views';
import type { PullView, TaskAskView } from '../../../../plugins/code-github/server/views';
import type {
  AgentListView,
  AgentTeamListView,
  AgentTeamSavedView,
  AgentView,
} from '../../../server/src/modules/task/agent/agent.view';
import type { AiTestView, AiToolListView } from '../../../server/src/modules/task/ai/ai-login.view';
import type {
  ApprovalPageView,
  ApprovalView,
} from '../../../server/src/modules/task/approval/approval.view';
import type { ChatDetailView, ChatListView } from '../../../server/src/modules/task/chat/chat.view';
import type { ExternalToolListView } from '../../../server/src/modules/task/external-tool/external-tool.view';
import type { GoalListView, GoalView } from '../../../server/src/modules/task/goal/goal.view';
import type {
  GoalRunDetailView,
  GoalRunListView,
} from '../../../server/src/modules/task/goal-run/goal-run.view';
import type {
  OutputPageView,
  OutputSavedView,
} from '../../../server/src/modules/task/output/output.view';
import type {
  RunnerListView,
  RunnerView,
} from '../../../server/src/modules/task/runner/runner.view';
import type {
  ScheduleListView,
  ScheduleView,
} from '../../../server/src/modules/task/schedule/schedule.view';
import type {
  SkillDetailView,
  SkillListView,
  SkillSavedView,
} from '../../../server/src/modules/task/skill/skill.view';
import type {
  TaskDetailView,
  TaskPageView,
  TaskView,
} from '../../../server/src/modules/task/task/task.view';
import type { UsageView } from '../../../server/src/modules/task/usage/usage.view';

// 서버가 돌려주는 모양. import 없는 view 파일의 toJSON()이 원본이다 (API설계 2장).
// 서버 코드가 웹 번들에 들어가지 않게 반드시 import type으로만 가져온다.

export type Task = ReturnType<TaskView['toJSON']>;
export type TaskPage = ReturnType<TaskPageView['toJSON']>;
export type TaskDetail = ReturnType<TaskDetailView['toJSON']>;
export type TaskEvent = TaskDetail['events'][number];
export type TaskRun = TaskDetail['runs'][number];
export type TaskOutput = TaskDetail['outputs'][number];
export type OutputPage = ReturnType<OutputPageView['toJSON']>;
export type Output = OutputPage['outputs'][number];
export type OutputUsage = OutputPage['usage'];
export type OutputSaved = ReturnType<OutputSavedView['toJSON']>;
export type Goal = ReturnType<GoalView['toJSON']>;
export type GoalList = ReturnType<GoalListView['toJSON']>;
export type GoalRunList = ReturnType<GoalRunListView['toJSON']>;
export type GoalRun = GoalRunList['runs'][number];
export type GoalRunDetail = ReturnType<GoalRunDetailView['toJSON']>;
export type GoalRound = GoalRunDetail['rounds'][number];
export type SkillList = ReturnType<SkillListView['toJSON']>;
export type SkillDetail = ReturnType<SkillDetailView['toJSON']>;
export type SkillSaved = ReturnType<SkillSavedView['toJSON']>;
export type Runner = ReturnType<RunnerView['toJSON']>;
export type RunnerList = ReturnType<RunnerListView['toJSON']>;
export type Approval = ReturnType<ApprovalView['toJSON']>;
/** 설정 바꾸기의 바뀔 칸 한 줄 (2026-11-15 C) */
export type SettingChangeLine = NonNullable<Approval['changes']>[number];
export type ApprovalPage = ReturnType<ApprovalPageView['toJSON']>;
export type Agent = ReturnType<AgentView['toJSON']>;
export type AgentList = ReturnType<AgentListView['toJSON']>;
/** 외부 도구 (2차 7단계). 토큰은 실리지 않는다 (hasSecret만) */
export type ExternalToolList = ReturnType<ExternalToolListView['toJSON']>;
export type ExternalTool = ExternalToolList['tools'][number];
export type AgentTeamList = ReturnType<AgentTeamListView['toJSON']>;
export type AgentTeam = AgentTeamList['teams'][number];
export type AgentTeamSaved = ReturnType<AgentTeamSavedView['toJSON']>;
export type Schedule = ReturnType<ScheduleView['toJSON']>;
export type ScheduleList = ReturnType<ScheduleListView['toJSON']>;
export type Usage = ReturnType<UsageView['toJSON']>;
export type UsageAgent = Usage['agents'][number];
export type UsageWindow = Usage['plan'][number];
/** AI 도구마다의 로그인 상태 (AI 메뉴, 러너 메뉴) */
export type AiTools = ReturnType<AiToolListView['toJSON']>;
export type AiTool = AiTools['tools'][number];
/** 맡긴 연결 확인 · 웹 로그인의 작업 */
export type AiTest = ReturnType<AiTestView['toJSON']>;
/** code-github 패키지의 PR (승인 화면의 code.pr.merge 대상). 패키지의 view가 원본이다 */
export type CodePull = ReturnType<PullView['toJSON']>;
/** code-github 패키지의 코드 작업 요청 (승인 화면의 code.task.start 대상, 2026-11-15 C) */
export type CodeAsk = ReturnType<TaskAskView['toJSON']>;
/** browser-tabs 패키지의 승인된 클릭 하나 (승인 화면이 그린다) */
export type BrowserClick = ReturnType<ClickDetailView['toJSON']>;
/** browser-tabs 패키지의 작업 화면 목록 · 하나 */
export type BrowserShots = ReturnType<ShotListView['toJSON']>;
export type BrowserShot = ReturnType<ShotImageView['toJSON']>;
export type ChatList = ReturnType<ChatListView['toJSON']>;
export type ChatSummary = ChatList['chats'][number];
export type ChatDetail = ReturnType<ChatDetailView['toJSON']>;
/** 대화 하나의 머리 (만들기 · 보내기의 응답도 이 모양) */
export type Chat = ChatDetail['chat'];
export type ChatTurn = ChatDetail['turns'][number];
/** 회차에 넣은 참조 하나 (2026-11-15 B) */
export type ChatRef = ChatTurn['refs'][number];
/** 팀이 동시에 일하는 칸의 한 줄 */
export type ChatTeamMember = ChatDetail['team'][number];
/** 기다리는 결과 카드 (2차 2단계) */
export type ChatCard = NonNullable<ChatDetail['card']>;
/** 대화의 소식 한 줄 (과정 · 맡기 전의 질문 · 답 · 맡음) */
export type ChatNews = ChatDetail['news'][number];
/** 맡기 전의 지금 질문과 고를 에이전트 (2차 1-5) */
export type ChatQuestion = NonNullable<ChatDetail['question']>;
