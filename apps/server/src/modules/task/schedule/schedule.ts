import { BaseEntity, RuleViolation, TableEntity, type Unchecked, ValueList } from '../../platform';
import { ChatResult } from '../chat/chat-result.policy';
import type { Goal } from '../goal/goal';
import { Task } from '../task/task';
import {
  SCHEDULE_DESTINATION,
  SCHEDULE_MODE,
  SCHEDULE_TRIGGER,
  type ScheduleDeliver,
  type ScheduleDestination,
  type ScheduleNew,
  type ScheduleRow,
} from '../task.tables';
import { SchedulePolicy } from './schedule.policy';
import { ScheduleView } from './schedule.view';

// 스케줄 하나 (task.schedules, 7단계). 정해진 시각에 지시대로 작업을 만든다. 하트비트를 넓힌 것이다.
// 2차 5단계에서 자동화 레시피가 되었다 (새 표 없이): 언제(계기) · 누가(담당) · 무엇을(지시 · 지킬 것) · 받을 것 · 어디로.
//   어디로: task(작업 하나) · chat(담당의 대화 회차 하나: 결과 카드 · 검사를 그대로) · page(페이지의 새 판, payload.page)
//   계기: time(정한 시각) · manual(손으로만) · after(다른 레시피의 일이 끝나면, after_id)
// 담당이 정해져 있고 지시가 비어 있으면 "정기 확인"(맡은 목표와 진행 중인 일을 확인)이 된다.
// 주기는 매일(시각 + 요일) 또는 N시간마다. 켜져 있으면 늘 다음 시각(next_run_at)이 있다 (DB CHECK).
// 하루 한도(daily_max): 스케줄의 시간대 기준 하루에 만드는 작업 수. 구독 AI를 사람 없이 돌리는 양을 묶는다 (기획서 11장).
// 설정은 configure로 한 번에 바꾸고, 때가 되면 fire가 이번 시각을 돌려주고 다음 시각으로 넘어간다.
// 작업을 만들 차례인지(하루 한도)는 claimRun이 정한다: 앞 작업이 안 끝났거나 에이전트가 쉬어 건너뛴 것은 세지 않는다.
export class Schedule extends TableEntity<ScheduleRow, ScheduleNew> {
  /** 때가 된 스케줄을 돌리는 마감 작업 (ScheduleJob). 다음 시각 · 켜기가 바뀌면 저장이 깨운다 */
  static readonly DUE_JOB = 'task.schedules';
  static readonly DAILY = 'daily';
  static readonly HOURLY = 'hourly';
  static readonly TITLE_MAX = 120;
  static readonly INSTRUCTION_MAX = 4000;
  /** 하루 한도의 끝 (N시간마다 1시간이면 하루 24번) */
  static readonly DAILY_MAX_LIMIT = 24;
  static readonly DEFAULT_INSTRUCTION = [
    '정기 확인입니다. 맡은 목표와 진행 중인 일을 확인합니다.',
    '할 일이 있으면 하거나 팀에게 맡기고, 없으면 확인한 것을 짧게 보고하고 끝냅니다.',
  ].join('\n');
  static readonly TASK = 'task';
  static readonly CHAT = 'chat';
  static readonly PAGE = 'page';
  static readonly TIME = 'time';
  static readonly MANUAL = 'manual';
  static readonly AFTER = 'after';
  static readonly RULES_MAX = 2000;
  /** 스케줄이 만든 작업의 request_id 앞부분 */
  static readonly REQUEST_PREFIX = 'schedule:';
  private static readonly MINUTES_PER_DAY = 1440;
  private static readonly HOURS_MAX = 24;
  private static readonly ALL_DAYS: readonly number[] = [1, 2, 3, 4, 5, 6, 7];

  /** 새 스케줄. 설정은 configure로 정한다 (만들 때도 같은 규칙) */
  static open(spaceId: string, settings: Partial<Unchecked<ScheduleRow>>, now: Date): Schedule {
    const schedule = new Schedule(
      {
        id: BaseEntity.newId(),
        space_id: spaceId,
        title: '',
        agent_id: null,
        mode: Schedule.DAILY,
        at_minute: 9 * 60,
        weekdays: Schedule.ALL_DAYS,
        every_hours: null,
        time_zone: 'UTC',
        instruction: '',
        goal_id: null,
        page_id: null,
        destination: Schedule.TASK,
        deliver: null,
        rules: '',
        trigger: Schedule.TIME,
        after_id: null,
        chat_id: null,
        daily_max: 3,
        run_day: null,
        day_runs: 0,
        enabled: false,
        next_run_at: null,
        last_run_at: null,
        created_at: now,
      },
      true,
    );
    schedule.configure(settings, now);
    return schedule;
  }

  static restore(row: ScheduleRow): Schedule {
    return new Schedule(row);
  }

  get spaceId(): string {
    return this.row.space_id;
  }

  get agentId(): string | null {
    return this.row.agent_id;
  }

  get goalId(): string | null {
    return this.row.goal_id;
  }

  get title(): string {
    return this.row.title;
  }

  get dailyMax(): number {
    return this.row.daily_max;
  }

  get destination(): ScheduleDestination {
    return this.row.destination;
  }

  /** 이 레시피가 회차를 쌓는 대화. 아직 열지 않았으면 null */
  get chatId(): string | null {
    return this.row.chat_id;
  }

  get rules(): string {
    return this.row.rules;
  }

  get deliver(): ScheduleDeliver | null {
    return this.row.deliver;
  }

  /**
   * 설정을 한 번에 바꾼다. 매일이면 at_minute와 요일, N시간마다면 every_hours만 쓴다.
   * 켜면 지금 뒤의 첫 시각을 다음 시각으로 정하고, 끄면 지운다. 오늘 센 수(day_runs)는 그대로 둔다
   */
  configure(settings: Partial<Unchecked<ScheduleRow>>, now: Date): void {
    const {
      title = '',
      agent_id: agentId = null,
      mode = '',
      at_minute: atMinute = null,
      weekdays = [],
      every_hours: everyHours = null,
      time_zone: timeZone = '',
      instruction = '',
      goal_id: goalId = null,
      page_id: pageId = null,
      destination = pageId === null ? Schedule.TASK : Schedule.PAGE,
      deliver = null,
      rules = '',
      trigger = Schedule.TIME,
      after_id: afterId = null,
      daily_max: dailyMax = 0,
      enabled = false,
    } = settings;
    const recipe = this.recipeOf(
      destination,
      pageId,
      agentId,
      instruction,
      deliver,
      rules,
      trigger,
      afterId,
    );
    const name = title.trim();
    if (name.length < 1 || name.length > Schedule.TITLE_MAX)
      throw new RuleViolation(`이름은 1~${Schedule.TITLE_MAX}자예요`);
    if (!ValueList.has(SCHEDULE_MODE, mode))
      throw new RuleViolation(`주기는 ${SCHEDULE_MODE.join(' · ')} 중 하나예요`);
    SchedulePolicy.assertTimeZone(timeZone);
    if (instruction.length > Schedule.INSTRUCTION_MAX)
      throw new RuleViolation(`지시는 ${Schedule.INSTRUCTION_MAX}자까지예요`);
    if (agentId === null && instruction.trim() === '')
      throw new RuleViolation('담당을 정하지 않으면 지시를 적어 주세요');
    const daily = mode === Schedule.DAILY;
    if (daily && (atMinute === null || atMinute < 0 || atMinute >= Schedule.MINUTES_PER_DAY))
      throw new RuleViolation('매일이면 시각(00:00~23:59)이 있어야 해요');
    const days = [...new Set(weekdays)].sort((a, b) => a - b);
    if (daily && (days.length === 0 || days.some((d) => !Schedule.ALL_DAYS.includes(d))))
      throw new RuleViolation('요일을 하나 이상 골라 주세요 (월 1 ~ 일 7)');
    if (!daily && (everyHours === null || everyHours < 1 || everyHours > Schedule.HOURS_MAX))
      throw new RuleViolation(`N시간마다면 1~${Schedule.HOURS_MAX}시간이에요`);
    if (!Number.isInteger(dailyMax) || dailyMax < 1 || dailyMax > Schedule.DAILY_MAX_LIMIT)
      throw new RuleViolation(`하루 한도는 1~${Schedule.DAILY_MAX_LIMIT}번이에요`);
    this.put('title', name);
    this.put('agent_id', agentId);
    this.put('mode', mode);
    this.put('at_minute', daily ? atMinute : null);
    this.put('weekdays', daily ? days : Schedule.ALL_DAYS);
    this.put('every_hours', daily ? null : everyHours);
    this.put('time_zone', timeZone);
    this.put('instruction', instruction);
    this.put('goal_id', goalId);
    // 대화의 받을 것은 대화를 열 때 정해진다: 바뀌면 다음 차례에 새 대화를 연다 (상대는 늘 대표, O-2)
    const before = this.row;
    const reopen =
      before.agent_id !== agentId ||
      before.deliver !== recipe.deliver ||
      recipe.destination !== Schedule.CHAT;
    if (reopen) this.put('chat_id', null);
    this.put('page_id', pageId);
    this.put('destination', recipe.destination);
    this.put('deliver', recipe.deliver);
    this.put('rules', rules);
    this.put('trigger', recipe.trigger);
    this.put('after_id', afterId);
    this.put('daily_max', dailyMax);
    this.put('enabled', enabled);
    this.put('next_run_at', enabled && recipe.trigger === Schedule.TIME ? this.after(now) : null);
  }

  /**
   * 레시피의 칸이 서로 맞는가: 어디로 ↔ 페이지 · 담당 · 지시, 받을 것은 대화에만, 계기 ↔ 앞 레시피.
   * 맞으면 값 목록으로 좁힌 어디로 · 받을 것 · 계기를 돌려준다
   */
  private recipeOf(
    destination: string,
    pageId: string | null,
    agentId: string | null,
    instruction: string,
    deliver: string | null,
    rules: string,
    trigger: string,
    afterId: string | null,
  ): Pick<ScheduleRow, 'destination' | 'deliver' | 'trigger'> {
    if (!ValueList.has(SCHEDULE_DESTINATION, destination))
      throw new RuleViolation(`어디로는 ${SCHEDULE_DESTINATION.join(' · ')} 중 하나예요`);
    if ((destination === Schedule.PAGE) !== (pageId !== null))
      throw new RuleViolation('페이지로 보내면 페이지를 골라요 (다른 곳이면 비워요)');
    // 대화로 보내는 레시피는 대표가 맡는다 (O-2): 담당은 비운다
    if (destination === Schedule.CHAT && agentId !== null)
      throw new RuleViolation('대화로 보내는 스케줄은 대표가 맡아요 (담당을 비워요)');
    if (destination === Schedule.CHAT && instruction.trim() === '')
      throw new RuleViolation('대화로 보내면 지시가 있어야 해요');
    if (deliver !== null && destination !== Schedule.CHAT)
      throw new RuleViolation('받을 것은 대화로 보낼 때만 정해요');
    const checked = ChatResult.deliverOf(deliver);
    if (rules.length > Schedule.RULES_MAX)
      throw new RuleViolation(`지킬 것은 ${Schedule.RULES_MAX}자까지예요`);
    if (!ValueList.has(SCHEDULE_TRIGGER, trigger))
      throw new RuleViolation(`계기는 ${SCHEDULE_TRIGGER.join(' · ')} 중 하나예요`);
    if ((trigger === Schedule.AFTER) !== (afterId !== null))
      throw new RuleViolation('다른 레시피 뒤에 돌리려면 그 레시피를 골라요');
    if (afterId !== null && afterId === this.id)
      throw new RuleViolation('자기 뒤에 돌 수는 없어요');
    return { destination, deliver: checked, trigger };
  }

  /** 때가 되었는가 (켜져 있고 다음 시각이 지났다) */
  dueAt(now: Date): boolean {
    const next = this.row.next_run_at;
    return this.row.enabled && next !== null && next <= now;
  }

  /**
   * 이번 시각을 돌려주고 다음 시각으로 넘어간다. 서버가 꺼져 시각을 여러 번 놓쳤어도 한 번만 깨우고
   * 지금 뒤의 첫 시각으로 간다 (놓친 만큼 몰아서 일하지 않는다). 작업을 만들지는 claimRun이 정한다
   */
  fire(now: Date): Date {
    const slot = this.row.next_run_at;
    if (!this.dueAt(now) || slot === null) throw new RuleViolation('아직 돌 때가 아니에요');
    this.put('last_run_at', now);
    this.put('next_run_at', this.after(now));
    return slot;
  }

  /**
   * 오늘(시간대 기준) 작업을 하나 더 만들 수 있으면 하나를 세고 true, 하루 한도에 닿았으면 false.
   * 날이 바뀌면 다시 0부터 센다
   */
  claimRun(now: Date): boolean {
    const today = SchedulePolicy.dayOf(now, this.row.time_zone);
    const used = this.row.run_day === today ? this.row.day_runs : 0;
    if (used >= this.row.daily_max) return false;
    this.put('run_day', today);
    this.put('day_runs', used + 1);
    return true;
  }

  /**
   * 앞 레시피의 일이 끝나 이 레시피를 돌릴 차례 (계기 after). 꺼져 있거나 하루 한도에 닿았으면 null (한도는 claimRun이 센다)
   */
  follow(now: Date): Date | null {
    if (!this.row.enabled || this.row.trigger !== Schedule.AFTER) return null;
    if (!this.claimRun(now)) return null;
    this.put('last_run_at', now);
    return now;
  }

  /** 대화로 보내는 레시피가 처음 연 대화를 기억한다 (다음 차례부터 그 대화의 회차) */
  openedChat(chatId: string): void {
    this.put('chat_id', chatId);
  }

  /** 대화에서 승인한 대화 레시피는 그 대화에 회차를 쌓는다 (O-3, 대화로 자동화). 다른 곳으로 보내는 레시피는 그대로 */
  bindChat(chatId: string | null): void {
    if (chatId !== null && this.row.destination === Schedule.CHAT) this.openedChat(chatId);
  }

  /** 주인이 누른 "지금 한 번". 하루 한도에 함께 센다. 닿았으면 RuleViolation */
  runNow(now: Date): Date {
    if (!this.claimRun(now))
      throw new RuleViolation(`오늘 한도(${this.row.daily_max}번)에 닿았어요. 내일 다시 돌아요`);
    return now;
  }

  /**
   * 이 시각에 만드는 작업. 목표가 닫혔으면 목표 없이. 담당이 없으면 빌릴 때 자동 배정.
   * 페이지를 가리키면 그 페이지의 새 판을 만드는 만들기 일 (make 권한이 있는 에이전트가 맡는다)
   */
  wake(slot: Date, goal: Goal | null, instruction: string, now: Date): Task {
    const pageId = this.row.page_id;
    const schedule = { id: this.id, at: slot.toISOString() };
    return Task.open(
      this.row.space_id,
      this.requestIdFor(slot),
      {
        agent_id: this.row.agent_id,
        kind: pageId ? Task.MAKE : Task.GENERAL,
        title: this.titleFor(slot),
        instruction,
        payload: pageId ? { schedule, page: { pageId } } : { schedule },
        goal_id: goal?.active ? goal.id : null,
      },
      now,
    );
  }

  /** 가리키는 페이지 (자라는 페이지). 없으면 null */
  get pageId(): string | null {
    return this.row.page_id;
  }

  /** 이 시각에 만드는 작업의 제목: 스케줄 이름과 시간대 기준 날짜 · 시각 */
  titleFor(slot: Date): string {
    const at = new Intl.DateTimeFormat('ko-KR', {
      timeZone: this.row.time_zone,
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(slot);
    return `${this.row.title} (${at})`.slice(0, 200);
  }

  /** 만드는 작업의 지시. 비어 있으면 정기 확인 */
  get taskInstruction(): string {
    return this.row.instruction.trim() || Schedule.DEFAULT_INSTRUCTION;
  }

  /** 작업의 request_id(task · page)나 대화 회차의 requestId(chat)에서 그 일을 만든 스케줄. 스케줄의 일이 아니면 null */
  static sourceOf(requestId: string | null): string | null {
    const match = /^schedule:([0-9a-f-]{36}):/.exec(requestId ?? '');
    return match ? (match[1] as string) : null;
  }

  /** 이 스케줄이 만든 작업의 request_id 앞부분 (앞 작업이 끝났는지 볼 때) */
  get requestPrefix(): string {
    return `${Schedule.REQUEST_PREFIX}${this.id}:`;
  }

  /** 이 시각에 만드는 작업의 request_id. 일꾼이 두 번 돌아도 작업은 하나다 */
  requestIdFor(slot: Date): string {
    return `${this.requestPrefix}${slot.toISOString()}`;
  }

  view(): ScheduleView {
    return new ScheduleView(this.row);
  }

  private after(now: Date): Date {
    const r = this.row;
    return r.mode === Schedule.DAILY
      ? SchedulePolicy.nextDaily(r.at_minute ?? 0, r.weekdays, r.time_zone, now)
      : SchedulePolicy.nextHourly(r.every_hours ?? 1, r.time_zone, now);
  }
}
