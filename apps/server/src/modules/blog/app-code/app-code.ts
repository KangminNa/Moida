import { BaseEntity, DomainEvent, NotFound, TableEntity } from '../../platform';
import type {
  AppCodeVersionNew,
  AppCodeVersionSource,
  AppKind,
  AppNew,
  AppRow,
} from '../blog.tables';
import { AppCodeStateView } from './app-code.view';
import type { AppCodeBundle } from './app-code-bundle';
import type { AppManifest } from './app-manifest';

// 앱의 코드 (스토어 1-6, docs/스토어.md 9장): blog.apps 한 줄의 코드 칸(code_seq · code_pending_seq · code_versions)과
// 추가만 하는 버전(blog.app_code_versions). 앱 이름 · 공개 여부 같은 설정은 App이 고치고, 여기서는 코드만 바꾼다
// (같은 줄이라 version 하나로 늦은 쓰기를 함께 막는다).
// 보이는 버전이 없으면(code_seq NULL) 종류의 시작 코드로 보인다. 비공개 앱의 새 버전은 바로 보이고,
// 공개 앱의 새 버전은 확인 대기로 두었다가 관리자가 "이 버전 공개"(show)를 누를 때 보인다 (원칙 7, 페이지와 같은 규칙).
export class AppCode extends TableEntity<AppRow, AppNew> {
  /** 새 버전이 쌓였다 (공개 앱이면 pending: 확인 대기 알림) · 보이는 버전이 바뀌었다 */
  static readonly ADDED = 'blog.app_code.added';
  static readonly SHOWN = 'blog.app_code.shown';
  /** AI 작업의 결과로 버전을 만들지 못했다 (묶음 규칙) */
  static readonly REFUSED = 'blog.app_code.refused';
  /** 결과 카드에서 고른 확인 대기 버전의 공개 (task의 결재 동작, 스토어 1-6b) */
  static readonly SHOW_ACTION = 'blog.app_code.show';
  static readonly NOTE_MAX = 2000;
  private static readonly PUBLIC = 'public';
  private static readonly COMMUNITY = 'community';
  /** 이번에 쌓을 버전 (saveParts가 넣는다) */
  private added: AppCodeVersionNew | null = null;

  static restore(row: AppRow): AppCode {
    return new AppCode(row);
  }

  get kind(): AppKind {
    return this.row.kind;
  }

  get spaceId(): string {
    return this.row.space_id;
  }

  /** 가장 새 버전 (확인 대기 버전이 있으면 그것). 없으면 0: 시작 코드 */
  get latestSeq(): number {
    return this.row.code_versions;
  }

  /**
   * 새 버전을 쌓는다. 비공개 앱은 바로 보이고, 공개 앱은 확인 대기 (앞의 대기 버전이 있으면 새 버전이 그 자리를 잇는다).
   * 시작 코드가 보이던 공개 앱도 기다린다: 방문자가 보던 모습이 확인 없이 바뀌지 않게
   */
  add(
    bundle: AppCodeBundle,
    source: AppCodeVersionSource,
    taskId: string | null,
    runId: string | null,
    note: string,
    now: Date,
  ): void {
    bundle.assertFits(this.row.kind);
    const seq = this.row.code_versions + 1;
    const held = this.row.visibility === AppCode.PUBLIC;
    this.put('code_versions', seq);
    this.put(held ? 'code_pending_seq' : 'code_seq', seq);
    if (!held) {
      this.put('code_pending_seq', null);
      this.put('code_manifest', bundle.manifest.toJSON());
    }
    this.put('updated_at', now);
    this.added = {
      id: BaseEntity.newId(),
      app_id: this.id,
      space_id: this.row.space_id,
      seq,
      files: bundle.files.toJSON(),
      source,
      task_id: taskId,
      run_id: runId,
      note: note.trim().slice(0, AppCode.NOTE_MAX),
      created_at: now,
    };
    const { space_id: spaceId, name } = this.row;
    this.record(
      new DomainEvent(AppCode.ADDED, 1, spaceId, {
        appId: this.id,
        name,
        seq,
        source,
        pending: held,
        // AI 작업이 만든 버전이면 그 작업 (task가 대화의 일이면 결과 카드에 공개 승인을 싣는다, 스토어 1-6b)
        taskId,
      }),
    );
    if (!held) this.announceShown(seq, true, bundle.manifest);
  }

  /**
   * 보이는 버전을 옮긴다 (확인 대기 버전 공개 · 앞 버전으로 되돌리기가 같다). 기다리던 버전이나 그보다 새 버전을 보이면
   * 기다림이 끝난다. 이미 그 버전이면 아무것도 바뀌지 않는다.
   * manifest: 그 버전의 선언서 (Service가 트랜잭션 전에 읽는다): 앱 줄의 code_manifest가 함께 바뀐다 (스토어 12.1)
   */
  show(seq: number, now: Date, manifest: AppManifest): void {
    if (seq < 1 || seq > this.row.code_versions) throw new NotFound(`없는 버전이에요: ${seq}`);
    const pending = this.row.code_pending_seq;
    const settles = pending !== null && seq >= pending;
    if (seq === this.row.code_seq && !settles) return;
    this.put('code_seq', seq);
    this.put('code_manifest', manifest.toJSON());
    if (settles) this.put('code_pending_seq', null);
    this.put('updated_at', now);
    this.announceShown(seq, settles, manifest);
  }

  /**
   * 대화의 결과 카드에서 승인한 공개 (스토어 1-6b). 그 버전이 아직 보이지 않을 때만 보인다: 그사이 관리자가 같은 버전이나
   * 더 새 버전을 공개했으면 되돌리지 않는다. 없는 버전이면 아무것도 하지 않는다 (승인은 이미 끝났다)
   */
  showApproved(seq: number, now: Date, manifest: AppManifest): void {
    if (seq < 1 || seq > this.row.code_versions) return;
    const current = this.row.code_seq;
    if (current !== null && current >= seq) return;
    this.show(seq, now, manifest);
  }

  /**
   * AI 작업의 결과가 묶음 규칙에 맞지 않아 버전을 만들지 못했다: 칸은 그대로 두고 까닭만 알린다 (관리자 알림).
   * 작업은 이미 끝났으니 되풀이하지 않는다
   */
  refuse(taskId: string, problem: string, _now: Date): void {
    const { space_id: spaceId, name } = this.row;
    this.record(
      new DomainEvent(AppCode.REFUSED, 1, spaceId, {
        appId: this.id,
        name,
        taskId,
        error: problem.slice(0, AppCode.NOTE_MAX),
      }),
    );
  }

  /** 저장할 새 버전 (Repository가 부른다) */
  get addedVersion(): AppCodeVersionNew | null {
    return this.added;
  }

  view(): AppCodeStateView {
    return new AppCodeStateView(this.row);
  }

  /**
   * settled: 확인 대기가 끝났나 (대기 버전보다 앞 버전으로 되돌린 것이면 아직 기다린다).
   * members · tables: 보이게 된 버전의 선언 (community가 받아 그 앱의 표를 맞춘다, 스토어 12.4)
   */
  private announceShown(seq: number, settled: boolean, manifest: AppManifest): void {
    const { members, tables } = manifest.toJSON();
    this.record(
      new DomainEvent(AppCode.SHOWN, 1, this.row.space_id, {
        appId: this.id,
        seq,
        settled,
        members: members || this.row.kind === AppCode.COMMUNITY,
        tables,
      }),
    );
  }
}
