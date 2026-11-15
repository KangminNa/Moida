import { DomainEvent, RuleViolation, TableEntity, ValueList } from '../../platform';
import type { NewNode } from '../change/change-target';
import {
  type SessionRow,
  TIDY_SETTING_CADENCE,
  type TidySettingCadence,
  type TidySettingNew,
  type TidySettingRow,
} from '../vault.tables';
import { TidySettingsView } from './tidy.view';

/** tidy_settings 한 줄. 공간마다 한 행이라 엔티티의 id는 공간 id다 */
export interface LoadedTidySettings extends TidySettingRow {
  id: string;
}

/** 정리를 맡길 세션 한 줄. revision_count는 지금 판 번호라 일 요청의 requestId가 된다 */
export type TidySessionRow = Pick<
  SessionRow,
  'node_id' | 'head_title' | 'revision_count' | 'version'
>;

// 공간 하나의 세션 정리 설정. 행이 없으면 꺼짐이다 (주인의 구독 토큰을 쓴다).
// 언제(cadence, 2차 7단계): 저장할 때마다(save) 또는 하루 한 번 몰아서(daily, 일꾼 TidyDailyJob이 부른다).
// 정리 일을 요청하는 쪽도 이 객체다: vault는 task를 모르므로 일 요청 이벤트(outbox)로 맡긴다.
// 같은 판의 요청은 requestId가 같아 몇 번을 보내도 작업은 하나다. 요청한 판은 TidyService가 세션에 적는다.
export class TidySettings extends TableEntity<LoadedTidySettings, NewNode<TidySettingNew>> {
  /** 하루 한 번 몰아서 요청하는 마감 작업 (TidyDailyJob). 설정을 저장하면 깨운다 */
  static readonly DAILY_JOB = 'vault.tidy-daily';
  /** task 모듈이 받는 일 요청. 러너는 kind로 cairn-tidy 스킬을 고른다 */
  private static readonly REQUESTED = 'task.task.requested';
  private static readonly KIND = 'tidy_session';
  /** 작업 제목의 상한 (task의 입력 검사와 같다) */
  private static readonly TITLE_MAX = 200;
  private static readonly TITLE_PREFIX = '세션 정리: ';
  private static readonly UNTITLED = '제목 없음';
  static readonly SAVE: TidySettingCadence = 'save';
  static readonly DAILY: TidySettingCadence = 'daily';
  /** 하루 한 번의 간격. 일꾼이 한 시간마다 보므로 조금 일찍 와도 그날 것으로 친다 */
  private static readonly DAY_MS = 23 * 60 * 60 * 1000;

  /** 아직 행이 없는 공간: 꺼짐, version 0. 켜고 끄기 전에는 저장할 것이 없다 */
  static absent(spaceId: string): TidySettings {
    return new TidySettings({
      id: spaceId,
      space_id: spaceId,
      auto_tidy: false,
      cadence: TidySettings.DAILY,
      daily_at: null,
      version: 0,
    });
  }

  static restore(row: LoadedTidySettings): TidySettings {
    return new TidySettings(row);
  }

  get autoTidy(): boolean {
    return this.row.auto_tidy;
  }

  /** 하루 한 번 몰아서 정리하는가 */
  get daily(): boolean {
    return (this.row.cadence ?? TidySettings.DAILY) === TidySettings.DAILY;
  }

  /** 자동 정리를 켜거나 끄고, 언제 할지 정한다 (보내지 않으면 그대로) */
  turn(on: boolean, cadence: string | null, now: Date): void {
    if (cadence !== null && !ValueList.has(TIDY_SETTING_CADENCE, cadence))
      throw new RuleViolation('정리는 저장할 때마다(save)나 하루 한 번(daily)이에요');
    const next = cadence ?? this.row.cadence ?? TidySettings.DAILY;
    if (on === this.row.auto_tidy && next === this.row.cadence) return;
    this.put('auto_tidy', on);
    this.put('cadence', next);
    this.put('updated_at', now);
  }

  /** 세션의 새 판이 저장되었다: 켜져 있고 저장마다 정리할 때만 요청한다 */
  sessionSaved(session: TidySessionRow, seq: number): void {
    if (this.row.auto_tidy && !this.daily) this.request(session, seq);
  }

  /** 하루 한 번의 차례인가: 켜져 있고, 하루 한 번이고, 지난 차례에서 하루가 지났다 */
  dueDaily(now: Date): boolean {
    const last = this.row.daily_at ?? null;
    return (
      this.row.auto_tidy &&
      this.daily &&
      (last === null || now.getTime() - last.getTime() >= TidySettings.DAY_MS)
    );
  }

  /** 하루 한 번의 차례: 새 판이 쌓인 세션을 요청하고 그때를 적는다 (세션이 없어도 적는다) */
  ranDaily(sessions: readonly TidySessionRow[], now: Date): void {
    this.backlog(sessions);
    this.put('daily_at', now);
  }

  /** 주인이 쌓인 세션의 정리를 요청한다. 자동 정리가 꺼져 있어도 된다 */
  backlog(sessions: readonly TidySessionRow[]): void {
    for (const session of sessions) this.request(session, session.revision_count);
  }

  view(): TidySettingsView {
    return new TidySettingsView(this.row);
  }

  private request(session: TidySessionRow, seq: number): void {
    const title = `${TidySettings.TITLE_PREFIX}${session.head_title || TidySettings.UNTITLED}`;
    this.record(
      new DomainEvent(TidySettings.REQUESTED, 1, this.row.space_id, {
        requestId: `tidy:${session.node_id}:${seq}`,
        kind: TidySettings.KIND,
        title: title.slice(0, TidySettings.TITLE_MAX),
        targetKind: 'session',
        targetId: session.node_id,
        baseVersion: session.version,
      }),
    );
  }
}
