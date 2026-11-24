import {
  RuleViolation,
  type SettingChangeInput,
  type SettingShape,
  ValueList,
} from '../../platform';
import { Member } from '../member/member';
import { DecideInput, MemberDecideInput } from './moderation.input';

/** 제안이 가리키는 대상의 종류 */
type Target = 'topic' | 'comment' | 'member';

// 일꾼의 신고 검토 제안 (2026-11-24, 스토어 3-3): 설정 바꾸기 `moderation` 하나가 글 · 댓글의 상태나 회원의 차단을 바꾸자고 한다.
// 관리자가 승인해야 반영된다 (원칙 7 · 10). 바뀐 점 줄은 지금 값과 받은 값의 차이다:
//   글 · 댓글 { app_id, target: topic · comment, state: shown · hidden · removed, open_reports: 0 } (대상 id = 글 · 댓글, version = 그 버전)
//     state의 뜻은 관리자 결정과 같다: shown 되돌림(열린 신고 기각) · hidden 가림 · removed 내림(열린 신고 인정).
//     open_reports는 늘 0으로 맞춘다 (결정하면 열린 신고가 닫힌다): 그대로 두는 판단(기각)도 바뀐 점 줄이 생긴다
//   회원 { app_id, target: member, blocked_until: "forever" · ISO 시각 · null } (대상 id = 회원, version = 회원 버전). null은 풀기
// 그 결정을 관리자 API와 같은 입력(DecideInput · MemberDecideInput)으로 바꿔 ModerationService가 같은 줄로 한다
export class ModerationChange {
  static readonly SETTING: SettingShape = {
    setting: 'moderation',
    list: 'moderation',
    ops: ['update'],
    fields: ['app_id', 'target', 'state', 'open_reports', 'blocked_until'],
    target: 'id',
    versioned: true,
    grants: 'all',
  };
  static readonly FOREVER = 'forever';
  private static readonly TARGETS: readonly Target[] = ['topic', 'comment', 'member'];
  private static readonly ACTIONS: Readonly<Record<string, string>> = {
    shown: 'show',
    hidden: 'hide',
    removed: 'remove',
  };
  private static readonly UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

  private constructor(
    readonly appId: string,
    readonly target: Target,
    readonly targetId: string,
    readonly version: number,
    private readonly body: Readonly<Record<string, unknown>>,
  ) {}

  static of(change: SettingChangeInput): ModerationChange {
    const { app_id: appId, target } = change.body;
    if (typeof appId !== 'string' || !ModerationChange.UUID.test(appId))
      throw new RuleViolation('app_id는 커뮤니티 앱의 id예요');
    if (!ValueList.has(ModerationChange.TARGETS, target))
      throw new RuleViolation('target은 topic · comment · member 가운데 하나예요');
    if (change.targetId === null || !ModerationChange.UUID.test(change.targetId))
      throw new RuleViolation('target_id는 글 · 댓글 · 회원의 id예요');
    return new ModerationChange(appId, target, change.targetId, change.version, change.body);
  }

  /** 받은 칸을 이 설정의 모양으로: 글 · 댓글은 열린 신고를 0으로 맞추고, 회원은 그 칸을 뺀다 */
  static normalize(fields: Readonly<Record<string, unknown>>): Record<string, unknown> {
    const { open_reports: _reports, ...rest } = fields;
    return fields.target === 'member' ? rest : { ...rest, open_reports: 0 };
  }

  get member(): boolean {
    return this.target === 'member';
  }

  /** 글 · 댓글에 내릴 결정 (관리자 API와 같은 입력). 상태가 틀리면 RuleViolation */
  decideInput(): DecideInput {
    const action = ModerationChange.ACTIONS[String(this.body.state)];
    if (this.member || action === undefined)
      throw new RuleViolation('state는 shown · hidden · removed 가운데 하나예요');
    const raw = { version: this.version, action };
    return this.target === 'topic'
      ? DecideInput.topic(this.appId, this.targetId, raw)
      : DecideInput.comment(this.appId, this.targetId, raw);
  }

  /** 회원에게 내릴 결정: 풀기(null)면 null까지, 아니면 차단 끝 (forever는 기한 없음) */
  memberInput(): { input: MemberDecideInput; block: boolean } {
    const until = this.body.blocked_until ?? null;
    if (!this.member || (until !== null && typeof until !== 'string'))
      throw new RuleViolation('blocked_until은 "forever" · ISO 시각 · null 가운데 하나예요');
    const forever = until === ModerationChange.FOREVER;
    const raw = { version: this.version, ...(until !== null && !forever ? { until } : {}) };
    return { input: MemberDecideInput.from(this.appId, this.targetId, raw), block: until !== null };
  }

  /** 회원의 지금 차단 끝을 제안과 같은 모양으로 (기한 없음은 forever) */
  static blockedOf(until: Date | null): string | null {
    if (until === null) return null;
    return until.getTime() >= Member.FOREVER.getTime()
      ? ModerationChange.FOREVER
      : until.toISOString();
  }
}
