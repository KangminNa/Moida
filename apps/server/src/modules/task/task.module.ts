import { Module, type OnModuleInit } from '@nestjs/common';
import {
  AgentDirectory,
  BlobStore,
  CoreWorkers,
  EventCatalog,
  Leases,
  LibraryQuery,
  SecretRotation,
} from '../platform';
import { AgentController } from './agent/agent.api';
import { AgentQuery } from './agent/agent.query';
import { AgentService } from './agent/agent.service';
import { AgentTeamController } from './agent/agent-team.api';
import { AiLoginController } from './ai/ai-login.api';
import { AiLoginQuery } from './ai/ai-login.query';
import { AiLoginService } from './ai/ai-login.service';
import { ApprovalController } from './approval/approval.api';
import { ApprovalQuery } from './approval/approval.query';
import { ApprovalService } from './approval/approval.service';
import { ApprovalResultHandler } from './approval/approval-result.handler';
import { AppCodeCardHandler } from './chat/app-code-card.handler';
import { ChatController } from './chat/chat.api';
import { ChatQuery } from './chat/chat.query';
import { ChatService } from './chat/chat.service';
import { ChatCardHandler } from './chat/chat-card.handler';
import { ChatContinueHandler } from './chat/chat-continue.handler';
import { ChatInspectHandler } from './chat/chat-inspect.handler';
import { ChatInspectService } from './chat/chat-inspect.service';
import { ChatResultHandler } from './chat/chat-result.handler';
import { ChatResultService } from './chat/chat-result.service';
import { ChatUpdateHandler } from './chat/chat-update.handler';
import { ChatUpdateQuery } from './chat/chat-update.query';
import { ChatUpdateService } from './chat/chat-update.service';
import { ExternalToolController } from './external-tool/external-tool.api';
import { ExternalToolQuery } from './external-tool/external-tool.query';
import { ExternalToolService } from './external-tool/external-tool.service';
import { ExternalToolCheckJob } from './external-tool/external-tool-check.job';
import { ExternalToolCheckService } from './external-tool/external-tool-check.service';
import { ExternalToolPlugHandler } from './external-tool/external-tool-plug.handler';
import { ExternalToolTaskHandler } from './external-tool/external-tool-task.handler';
import { GoalController } from './goal/goal.api';
import { GoalQuery } from './goal/goal.query';
import { GoalService } from './goal/goal.service';
import { GoalRunController } from './goal-run/goal-run.api';
import { GoalRunHandler } from './goal-run/goal-run.handler';
import { GoalRunQuery } from './goal-run/goal-run.query';
import { GoalRunService } from './goal-run/goal-run.service';
import { InboxQuery } from './inbox/inbox.query';
import { OutputController } from './output/output.api';
import { OutputPolicy } from './output/output.policy';
import { OutputQuery } from './output/output.query';
import { OutputService } from './output/output.service';
import { OutputPurgeJob } from './output/output-purge.job';
import { OutputShareController } from './output-share/output-share.api';
import { OutputShareQuery } from './output-share/output-share.query';
import { OutputShareService } from './output-share/output-share.service';
import { RunnerController } from './runner/runner.api';
import { RunnerQuery } from './runner/runner.query';
import { RunnerService } from './runner/runner.service';
import { ScheduleController } from './schedule/schedule.api';
import { ScheduleJob } from './schedule/schedule.job';
import { ScheduleQuery } from './schedule/schedule.query';
import { ScheduleService } from './schedule/schedule.service';
import { ScheduleFollowHandler } from './schedule/schedule-follow.handler';
import { SettingApplyHandler } from './setting-change/setting-apply.handler';
import { SettingQuery } from './setting-change/setting-change.query';
import { SettingChangeService } from './setting-change/setting-change.service';
import { RepoSkillGateway } from './skill/repo-skill.gateway';
import { SkillController } from './skill/skill.api';
import { SkillQuery } from './skill/skill.query';
import { SkillService } from './skill/skill.service';
import { AgentlessService } from './task/agentless.service';
import { AgentlessRequestHandler } from './task/agentless-request.handler';
import { JobService } from './task/job.service';
import { LeaseJob } from './task/lease.job';
import { LessonHandler } from './task/lesson.handler';
import { LessonQuery } from './task/lesson.query';
import { SubtaskService } from './task/subtask.service';
import { SubtaskSettledHandler } from './task/subtask-settled.handler';
import { SubtaskWaitJob } from './task/subtask-wait.job';
import { Task } from './task/task';
import { TaskController } from './task/task.api';
import { TaskQuery } from './task/task.query';
import { TaskService } from './task/task.service';
import { TaskRequestedHandler } from './task/task-requested.handler';
import { TeamReviewHandler } from './task/team-review.handler';
import { TeamReviewQuery } from './task/team-review.query';
import events from './task.events.json';
import { TaskNotices } from './task-notices';
import { TaskSettings } from './task-settings';
import { TaskTools } from './task-tools';
import { UsageController } from './usage/usage.api';
import { UsageQuery } from './usage/usage.query';
import { VerdictHandler } from './verdict/verdict.handler';
import { VerdictService } from './verdict/verdict.service';
import { WebQuery } from './web/web.query';
import { WebPageGateway } from './web/web-page.gateway';

// 에이전트가 일하고 주인이 결재하는 구조: 에이전트(조직도 · 하트비트), 목표, 작업(실행 기록 · 위임), 결재. platform에만 의존한다.
// 결재 뒤 실행은 대상을 가진 모듈이 이벤트로 한다. task.approval.granted를 받는 모듈이 expect도 적는다 (지금은 blog).
@Module({
  providers: [
    TaskNotices,
    TaskSettings,
    AgentQuery,
    AgentService,
    TaskQuery,
    TaskService,
    JobService,
    ApprovalQuery,
    ApprovalService,
    UsageQuery,
    GoalQuery,
    GoalService,
    ScheduleQuery,
    ScheduleService,
    ScheduleJob,
    RunnerQuery,
    RunnerService,
    AiLoginQuery,
    AiLoginService,
    TaskTools,
    ...TaskTools.PROVIDERS,
    TaskRequestedHandler,
    AgentlessRequestHandler,
    AgentlessService,
    InboxQuery,
    SubtaskSettledHandler,
    SubtaskService,
    ApprovalResultHandler,
    LeaseJob,
    SubtaskWaitJob,
    // 저장소 skills/의 러너 스킬 (서버 이미지에 함께 든 판). 처음 한 번 읽는다
    { provide: RepoSkillGateway, useFactory: () => RepoSkillGateway.fromEnv() },
    SkillQuery,
    SkillService,
    // 결과물의 공간 한도 · 디스크 여유 (CAIRN_OUTPUTS_MAX_GB · CAIRN_DISK_RESERVE_GB)
    { provide: OutputPolicy, useFactory: () => OutputPolicy.fromEnv() },
    OutputQuery,
    OutputService,
    OutputShareQuery,
    OutputShareService,
    // 목표 실행: 회차 루프와 결재 (GoalRunHandler가 회차 끝 · 결재를 받는다)
    GoalRunQuery,
    GoalRunService,
    ChatQuery,
    ChatService,
    // 대화의 소식 (2차 1-1): 끝난 작업 → 소식(ChatUpdateHandler), agent_updates · post_update
    ChatUpdateService,
    ChatUpdateQuery,
    ChatUpdateHandler,
    // 결과 결재 (2차 2단계): 가라앉은 회차 → 검사 · 검토 · 결과 카드, 카드의 수정 요청 · 반려 → 멈추고 다음 회차
    ChatResultService,
    ChatResultHandler,
    // 검수 (2026-11-20): 끝난 검수 작업 → 결재에 검수의 결정 (통과면 검수자가 승인)
    ChatInspectService,
    ChatInspectHandler,
    ChatCardHandler,
    // 평가가 남는 팀 (2026-11-20): 끝난 검토 · 검수 작업 → 판정을 점수와 함께 쌓는다 (성적표 · 주간 팀 점검)
    VerdictService,
    VerdictHandler,
    // 피드백에서 배우기 (2026-11-20): 관리자의 수정 요청 메모가 쌓이면 대표에게 배우기 일
    LessonQuery,
    LessonHandler,
    // 주간 팀 점검 (2026-11-20): 7일마다 대표에게 성적표로 팀을 점검하는 일
    TeamReviewQuery,
    TeamReviewHandler,
    // 대화의 만들기 일이 낸 앱 코드의 확인 대기 버전 → 결과 카드의 공개 승인 (스토어 1-6b)
    AppCodeCardHandler,
    // 승인 뒤 이어서 (O-2): 대표가 continue로 올린 설정 바꾸기가 적용되어 끝난 회차 → 같은 대화의 다음 회차
    ChatContinueHandler,
    GoalRunHandler,
    // 주소 읽기 (read_url): 서버가 AI 대신 연다. 목줄은 WebReach
    WebPageGateway,
    WebQuery,
    OutputPurgeJob,
    // 자동화 레시피 (2차 5단계): 레시피의 일이 끝나면 그 뒤의 레시피 (계기 after)
    ScheduleFollowHandler,
    // 외부 도구 꽂기 (2차 7단계)
    ExternalToolService,
    ExternalToolQuery,
    ExternalToolPlugHandler,
    // MCP 먼저 1단계 (2026-11-15): 커넥터 확인 · 사용 기록
    ExternalToolCheckService,
    ExternalToolTaskHandler,
    ExternalToolCheckJob,
    // 설정 바꾸기 제안 (2026-11-15 C · D): 미리 해 보고 결재로, 승인 뒤 그 설정을 가진 모듈이 적용 (platform SettingKinds)
    SettingQuery,
    SettingChangeService,
    SettingApplyHandler,
  ],
  controllers: [
    AgentController,
    AgentTeamController,
    TaskController,
    ApprovalController,
    UsageController,
    AiLoginController,
    GoalController,
    ScheduleController,
    RunnerController,
    SkillController,
    OutputController,
    OutputShareController,
    GoalRunController,
    ChatController,
    ExternalToolController,
  ],
  exports: [TaskTools, TaskQuery],
})
export class TaskModule implements OnModuleInit {
  /** 스케줄의 가장 작은 단위가 분이라 1분마다 본다 */

  constructor(
    private readonly workers: CoreWorkers,
    private readonly requested: TaskRequestedHandler,
    private readonly settled: SubtaskSettledHandler,
    private readonly chatUpdates: ChatUpdateHandler,
    private readonly results: ApprovalResultHandler,
    private readonly leases: LeaseJob,
    private readonly waits: SubtaskWaitJob,
    private readonly schedules: ScheduleJob,
    private readonly rotation: SecretRotation,
    private readonly logins: AiLoginService,
    private readonly outputPurge: OutputPurgeJob,
    private readonly blobs: BlobStore,
    private readonly outputs: OutputQuery,
    private readonly leaseChecks: Leases,
    private readonly tasks: TaskQuery,
    private readonly goalRuns: GoalRunHandler,
    private readonly chatResults: ChatResultHandler,
    private readonly chatInspections: ChatInspectHandler,
    private readonly verdicts: VerdictHandler,
    private readonly chatCards: ChatCardHandler,
    private readonly lessons: LessonHandler,
    private readonly teamReviews: TeamReviewHandler,
    private readonly appCodeCards: AppCodeCardHandler,
    private readonly chatContinues: ChatContinueHandler,
    private readonly agentless: AgentlessRequestHandler,
    private readonly library: LibraryQuery,
    private readonly follows: ScheduleFollowHandler,
    private readonly directory: AgentDirectory,
    private readonly agentQuery: AgentQuery,
    private readonly agentService: AgentService,
    private readonly toolPlugs: ExternalToolPlugHandler,
    private readonly externalTools: ExternalToolService,
    private readonly settingApply: SettingApplyHandler,
    private readonly toolTasks: ExternalToolTaskHandler,
    private readonly toolChecks: ExternalToolCheckJob,
  ) {}

  onModuleInit(): void {
    EventCatalog.define('task', events);
    this.workers.on(Task.REQUESTED, this.requested);
    this.workers.on(AgentlessRequestHandler.TOPIC, this.agentless);
    this.workers.on(Task.CHANGED, this.settled);
    this.workers.on(Task.CHANGED, this.chatUpdates);
    this.workers.on(Task.CHANGED, this.goalRuns);
    for (const topic of GoalRunHandler.DECIDED) this.workers.on(topic, this.goalRuns);
    for (const topic of ChatResultHandler.TOPICS) this.workers.on(topic, this.chatResults);
    this.workers.on(Task.CHANGED, this.chatInspections);
    this.workers.on(Task.CHANGED, this.verdicts);
    for (const topic of ChatCardHandler.TOPICS) this.workers.on(topic, this.chatCards);
    for (const topic of LessonHandler.TOPICS) this.workers.on(topic, this.lessons);
    this.workers.on(Task.CHANGED, this.teamReviews);
    this.workers.on(AppCodeCardHandler.TOPIC, this.appCodeCards);
    this.workers.on(Task.CHANGED, this.chatContinues);
    this.workers.on(Task.CHANGED, this.follows);
    for (const topic of ApprovalResultHandler.TOPICS) this.workers.on(topic, this.results);
    this.workers.due(this.leases, Task.CHANGED);
    this.workers.due(this.waits, Task.CHANGED);
    this.workers.due(this.schedules);
    this.rotation.register('task.ai_logins', (actor) => this.logins.resealSecrets(actor));
    // 외부 도구 (2차 7단계): 제안의 결재가 정해지면 붙이거나 지우고, 서버 키를 바꾸면 토큰을 다시 잠근다
    for (const topic of ExternalToolPlugHandler.TOPICS) this.workers.on(topic, this.toolPlugs);
    // 설정 바꾸기 (2026-11-15 C · D): 승인되면 그 설정을 가진 모듈이 적용하고 결과(<모듈>.setting.changed)를 남긴다
    this.workers.on(SettingApplyHandler.TOPIC, this.settingApply);
    // MCP 먼저 (2026-11-15): 끝난 작업에서 커넥터 확인 결과 · 사용을 적고, 때가 된 커넥터에 확인을 맡긴다
    this.workers.on(Task.CHANGED, this.toolTasks);
    this.workers.due(this.toolChecks, Task.CHANGED);
    this.rotation.register('task.external_tools', (actor) =>
      this.externalTools.resealSecrets(actor),
    );
    this.workers.due(this.outputPurge);
    // 기능 패키지의 도구(code-github의 code_credential 등)가 묻는 임대 확인
    this.leaseChecks.register((actor, id) => this.tasks.leasedWork(actor, id));
    this.leaseChecks.registerRecord((actor, id) => this.tasks.recordTarget(actor, id));
    // 결과물이 가리키는 파일: 쓰는 동안 platform이 지우지 않게
    this.blobs.registerUse(['task.outputs.blob_hash'], (actor, hashes) =>
      this.outputs.usedBlobs(actor, hashes),
    );
    // 다른 모듈이 묻는 에이전트 (2차 6단계, blog 메뉴의 운영 팀)
    this.directory.register((actor, id) => this.agentQuery.card(actor, id));
    // 승인한 앱 만들기의 앱 운영 팀 (스토어 2-6, blog의 new_team)
    this.directory.registerTeamMaker(
      async (actor) => (await this.agentService.createAppTeam(actor)).id,
    );
    // 보관함의 결과물 (2차 5단계)
    this.library.register([OutputQuery.LIBRARY_KIND], (a, f) => this.outputs.library(a, f));
  }
}
