import {
  BaseEntity,
  type ColumnRules,
  DomainEvent,
  RuleViolation,
  SealedSecret,
  type SecretBox,
  TableEntity,
} from '../../platform';
import type { Agent } from '../agent/agent';
import { AiTasks } from '../ai/ai-task';
import { JobToolView } from '../task/job.view';
import { Task } from '../task/task';
import type { ExternalToolNew, ExternalToolRow } from '../task.tables';
import { ExternalToolView, ProposedToolView } from './external-tool.view';
import { ExternalToolUrl } from './external-tool-url.policy';
import { ToolCatalog } from './tool-catalog.policy';

// 외부 도구 하나 (task.external_tools, 2차 7단계): 바깥 서비스의 원격 MCP 서버. 에이전트마다 허락하면 러너가 그 일에만 붙인다.
// 붙이는 길은 둘: 관리자가 콘솔에서 더하면 바로 쓴다(active). AI가 제안하면(propose_tool) proposed로 두고,
// 그 에이전트가 올린 결재(task.tool.plug)가 승인되면 active가 되고 제안한 에이전트에 붙는다.
// 토큰(머리글의 값)은 서버 키로 잠가 두고 일을 빌려 줄 때만 푼다 (jobView). 머리글이 있는데 토큰이 없으면 붙이지 않는다.
export class ExternalTool extends TableEntity<ExternalToolRow, ExternalToolNew> {
  /** 제안한 도구를 붙이는 결재 동작 */
  static readonly PLUG = 'task.tool.plug';
  /** 결재의 대상 종류 */
  static readonly TARGET = 'external_tool';
  static readonly PROPOSED = 'proposed';
  static readonly ACTIVE = 'active';
  /** 확인할 때가 된 커넥터에 확인을 맡기는 마감 작업 (ExternalToolCheckJob). 켜기 · 고치기 · 확인 결과가 바뀌면 저장이 깨운다 */
  static readonly CHECK_JOB = 'task.external_tools.check';
  static readonly OFF = 'off';
  static readonly NAME_MAX = 30;
  static readonly TITLE_MAX = 60;
  static readonly NOTE_MAX = 1000;
  static readonly SECRET_MAX = 4000;
  /** 러너 안의 MCP 서버 이름 앞부분: cairn · playwright와 겹치지 않게 */
  static readonly SERVER_PREFIX = 'x-';
  private static readonly NAME = /^[a-z][a-z0-9-]{1,29}$/;
  private static readonly HEADER = /^[A-Za-z0-9-]{1,40}$/;
  /** 토큰을 싣지 않는 머리글: 요청의 모양을 바꾸는 것 */
  private static readonly RESERVED_HEADERS = [
    'host',
    'content-length',
    'content-type',
    'transfer-encoding',
    'connection',
  ];

  /** 주인(또는 제안한 AI)이 정하는 칸과 그 규칙. 이름은 만들 때 한 번만 (nameOf) */
  private static readonly RULES: ColumnRules<ExternalToolRow> = {
    title: (value) => {
      const title = value.trim();
      if (title.length < 1 || title.length > ExternalTool.TITLE_MAX)
        throw new RuleViolation(`이름표는 1~${ExternalTool.TITLE_MAX}자예요`);
      return title;
    },
    url: (value) => ExternalToolUrl.check(value),
    header_name: (value) => {
      if (value === null || value.trim() === '') return null;
      const header = value.trim();
      if (
        !ExternalTool.HEADER.test(header) ||
        ExternalTool.RESERVED_HEADERS.includes(header.toLowerCase())
      )
        throw new RuleViolation('토큰을 실을 머리글 이름이 맞지 않아요 (예: Authorization)');
      return header;
    },
    note: (value) => {
      if (value.length > ExternalTool.NOTE_MAX)
        throw new RuleViolation(`까닭은 ${ExternalTool.NOTE_MAX}자까지예요`);
      return value;
    },
  };

  /** 관리자가 더한 도구: 바로 쓴다 */
  static open(
    spaceId: string,
    name: string,
    fields: Partial<ExternalToolRow>,
    now: Date,
  ): ExternalTool {
    return ExternalTool.start(spaceId, name, fields, ExternalTool.ACTIVE, null, now);
  }

  /** AI가 제안한 도구: 결재(task.tool.plug)를 기다린다. 토큰은 받지 않는다 (AI는 비밀을 다루지 않는다) */
  static propose(
    spaceId: string,
    agentId: string,
    name: string,
    fields: Partial<ExternalToolRow>,
    now: Date,
  ): ExternalTool {
    return ExternalTool.start(spaceId, name, fields, ExternalTool.PROPOSED, agentId, now);
  }

  private static start(
    spaceId: string,
    name: string,
    fields: Partial<ExternalToolRow>,
    status: string,
    proposedBy: string | null,
    now: Date,
  ): ExternalTool {
    const tool = new ExternalTool(
      {
        id: BaseEntity.newId(),
        space_id: spaceId,
        name: ExternalTool.nameOf(name),
        title: '',
        url: '',
        header_name: null,
        secret: null,
        nonce: null,
        status,
        note: '',
        proposed_by: proposedBy,
        created_at: now,
        updated_at: now,
      },
      true,
    );
    tool.accept({ title: '', url: '', header_name: null, note: '', ...fields }, ExternalTool.RULES);
    return tool;
  }

  static restore(row: ExternalToolRow): ExternalTool {
    return new ExternalTool(row);
  }

  /** 이름의 규칙: 소문자 · 숫자 · -, 2~30자, 글자로 시작 (러너의 MCP 서버 이름이 된다) */
  static nameOf(value: string): string {
    const name = value.trim();
    if (!ExternalTool.NAME.test(name))
      throw new RuleViolation(
        `이름은 영문 소문자로 시작하는 소문자 · 숫자 · - ${ExternalTool.NAME_MAX}자까지예요`,
      );
    return name;
  }

  get spaceId(): string {
    return this.row.space_id;
  }

  get name(): string {
    return this.row.name;
  }

  /** 제안한 에이전트 (관리자가 더한 도구는 null) */
  get proposedBy(): string | null {
    return this.row.proposed_by;
  }

  get proposed(): boolean {
    return this.row.status === ExternalTool.PROPOSED;
  }

  /** 러너에 붙일 수 있는가: 켜져 있고, 머리글이 있으면 토큰도 있다 */
  get ready(): boolean {
    return (
      this.row.status === ExternalTool.ACTIVE &&
      (this.row.header_name === null || this.row.secret !== null)
    );
  }

  /**
   * 연결 확인 일 하나 (tool_check, 2026-11-15 MCP 1단계). 에이전트 없이 러너가 원격 MCP에 붙어 tools/list를 받고,
   * 결과는 ExternalToolTaskHandler가 이 도구에 적는다. 붙일 수 없는 도구(꺼짐 · 제안 · 토큰 없음)는 확인하지 않는다
   */
  checkTask(now: Date): Task {
    if (!this.ready) throw new RuleViolation('켜져 있고 토큰이 갖춰진 커넥터만 확인해요');
    const fields = {
      kind: Task.TOOL_CHECK,
      title: `커넥터 확인: ${this.row.title}`,
      payload: { toolId: this.id, toolVersion: this.row.version ?? 1 },
      priority: AiTasks.PRIORITY,
    };
    return Task.open(this.row.space_id, BaseEntity.newId(), fields, now);
  }

  /** 주인이 고친 칸을 적는다. 머리글을 비우면 토큰도 지운다 */
  edit(changes: Partial<ExternalToolRow>, now: Date): void {
    this.accept(changes, ExternalTool.RULES);
    if (this.row.header_name === null && this.row.secret !== null) this.clearSecret();
    this.put('updated_at', now);
  }

  /** 켜기 · 끄기. 제안은 결재로만 켠다 */
  switchTo(on: boolean, now: Date): void {
    if (this.proposed) throw new RuleViolation('제안한 도구는 승인으로 정해요');
    this.put('status', on ? ExternalTool.ACTIVE : ExternalTool.OFF);
    this.put('updated_at', now);
  }

  /** 토큰(머리글의 값)을 넣거나 바꾼다. 머리글을 먼저 정해야 한다 */
  setSecret(sealed: SealedSecret, now: Date): void {
    if (this.row.header_name === null) throw new RuleViolation('토큰을 실을 머리글을 먼저 정해요');
    this.put('secret', sealed.ciphertext);
    this.put('nonce', sealed.nonce);
    this.put('updated_at', now);
  }

  /** 토큰의 값 검사 (봉인 전에) */
  static secretOf(value: string): string {
    if (value.length < 1 || value.length > ExternalTool.SECRET_MAX || /[\r\n]/.test(value))
      throw new RuleViolation(`토큰은 한 줄, ${ExternalTool.SECRET_MAX}자까지예요`);
    return value;
  }

  /**
   * 제안을 승인했다 (결재 task.tool.plug): 켜고 제안한 에이전트에 붙인다. 결과를 이벤트로 돌려준다.
   * 결재를 올린 뒤 바뀐 제안 · 이미 정한 제안 · 붙일 수 없는 에이전트면 실패 결과 (부른 쪽은 저장하지 않는다)
   */
  plugApproved(
    approvalId: string,
    targetVersion: number | null,
    agent: Agent | null,
    now: Date,
  ): DomainEvent {
    const problem = this.plugProblem(targetVersion, agent);
    if (problem) return ExternalTool.failed(this.row.space_id, this.id, approvalId, problem);
    agent?.plugTool(this.row.name);
    this.put('status', ExternalTool.ACTIVE);
    this.put('updated_at', now);
    return new DomainEvent('task.external_tool.plugged', 1, this.row.space_id, {
      toolId: this.id,
      name: this.row.name,
      agentId: agent?.id ?? null,
      approvalId,
      outcome: 'done',
    });
  }

  /** 붙이지 못한 결과. 도구를 찾지 못해도 작업은 끝나야 해서 도구 없이 만든다 */
  static failed(spaceId: string, toolId: string, approvalId: string, error: string): DomainEvent {
    return new DomainEvent('task.external_tool.plug_failed', 1, spaceId, {
      toolId,
      approvalId,
      outcome: 'failed',
      error,
    });
  }

  /**
   * 확인 결과 · 사용 기록을 적었다는 알림 (화면이 다시 읽는다). 이 칸들은 주인의 편집과 겨루지 않게 버전 없이 적어서
   * (ExternalToolRepository.noteCheck · noteUsage) 엔티티를 거치지 않고 이벤트만 여기서 만든다
   */
  static noted(spaceId: string, data: { toolId: string } | { names: string[] }): DomainEvent {
    return new DomainEvent('task.external_tool.noted', 1, spaceId, data);
  }

  /** 서버 키를 바꾼 뒤 지금 키로 다시 잠근다. 바꿨으면 true */
  reseal(box: SecretBox): boolean {
    if (this.row.secret === null || this.row.nonce === null) return false;
    const fresh = box.reseal(new SealedSecret(this.row.secret, this.row.nonce));
    if (!fresh) return false;
    this.put('secret', fresh.ciphertext);
    this.put('nonce', fresh.nonce);
    return true;
  }

  /** 관리 화면의 한 줄. agents는 이 도구를 허락한 에이전트 (이름) */
  view(agents: readonly { id: string; name: string }[] = []): ExternalToolView {
    return new ExternalToolView(this.row, agents);
  }

  /** propose_tool의 답 (AI가 이 id · version으로 결재를 올린다) */
  proposedView(): ProposedToolView {
    return new ProposedToolView(this.row);
  }

  /** 러너에게 가는 모양: 토큰을 여기서만 푼다 (일을 빌려 줄 때). 봉인한 칸을 아는 곳을 이 엔티티 하나로 둔다 */
  jobView(box: SecretBox): JobToolView {
    const { secret, nonce, header_name: header } = this.row;
    const value = secret && nonce && header ? box.open(new SealedSecret(secret, nonce)) : null;
    const headers = header && value ? { [header]: value } : {};
    return new JobToolView(this.row, headers, ToolCatalog.jobLines(this.row.catalog));
  }

  private plugProblem(targetVersion: number | null, agent: Agent | null): string | null {
    if (!this.proposed) return '이미 정한 제안이에요';
    if (targetVersion !== null && this.version !== targetVersion)
      return `승인 요청 뒤 바뀐 제안이라 붙이지 않았어요 (요청 때 버전 ${targetVersion}, 지금 ${this.version})`;
    return agent?.toolProblem(this.row.name) ?? null;
  }

  private clearSecret(): void {
    this.put('secret', null);
    this.put('nonce', null);
  }
}
