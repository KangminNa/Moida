import { BaseEntity, Conflict, Forbidden, RuleViolation, TableEntity } from '../../platform';
import type { MemberNew, MemberRow } from '../community.tables';
import { MemberDecidedView, MemberResetView } from '../moderation/moderation.view';
import { MemberSelfView } from './member.view';
import { Nickname } from './nickname.policy';

// 앱의 회원 하나 (community.members, 스토어 3-1): 스토어 계정(Account)의 "앱 참여"다 (2026-11-26).
// 메일 · 아이디 · 비밀번호 · 로그인은 계정의 것이고, 닉네임 · 차단 · 가입 대기 · 앱 약관 동의 · 글은 앱마다 이 회원의 것이다.
// 앱에서 나가면(leave) 계정과의 연결을 끊고 닉네임을 지운다. IP는 갖지 않는다. 관리자가 아니다 (원칙 10)
export class Member extends TableEntity<MemberRow, MemberNew> {
  /** 가입하고 이만큼 지나야 글 · 댓글을 쓴다 (스팸, 11.0) */
  static readonly JOIN_WAIT_MS = 5 * 60_000;
  /** 닉네임은 이 간격에 한 번 바꾼다 (자주 바꿔 다른 사람인 척하지 못하게) */
  static readonly RENAME_DAYS = 7;
  private static readonly DAY_MS = 86_400_000;
  /** 무기한 차단의 끝 (DB의 infinity는 Date로 읽히지 않아 먼 날짜로 둔다) */
  static readonly FOREVER = new Date('9999-12-31T00:00:00Z');
  /** 나간 회원이 글 · 댓글 · 관리 화면에 보이는 이름 (Nickname이 회원에게는 막는다) */
  static readonly LEFT_NAME = '탈퇴한 회원';

  /**
   * 앱 참여: 계정 하나가 이 앱의 회원이 된다. 만 14세 확인은 계정의 것을 옮겨 적는다.
   * 닉네임 규칙은 Nickname, 닉네임 겹침 · 같은 계정의 두 번째 참여는 DB가 본다 (409)
   */
  static enter(
    appId: string,
    accountId: string,
    nickname: string,
    ageConfirmedAt: Date,
    now: Date,
  ): Member {
    const clean = Nickname.clean(nickname);
    return new Member(
      {
        id: BaseEntity.newId(),
        app_id: appId,
        account_id: accountId,
        nickname: clean,
        nickname_key: Nickname.keyOf(clean),
        age_confirmed_at: ageConfirmedAt,
        joined_at: now,
      },
      true,
    );
  }

  static restore(row: MemberRow): Member {
    return new Member(row);
  }

  /** 이 회원의 계정 (나간 회원은 null) */
  get accountId(): string | null {
    return this.row.account_id;
  }

  get nickname(): string {
    return this.row.nickname;
  }

  /**
   * 참여할 때 동의한 이 앱의 약관 버전 (앱이 자기 약관을 공개했을 때만, 없으면 null).
   * 맞는 버전인지는 Service가 TermsConsent로 본다 (화면을 연 뒤 약관이 바뀌었으면 409로 다시 읽게)
   */
  agree(termsVersion: number | null, privacyVersion: number | null): void {
    this.put('terms_version', termsVersion);
    this.put('privacy_version', privacyVersion);
  }

  /**
   * 앱에서 나가기 (계정 탈퇴도 모든 앱에서 이것을 한다): 계정과의 연결 · 닉네임 · 차단 메모 · 마지막 접근을 지운다.
   * 줄은 남긴다: 글 · 댓글 · 신고 · 결정 기록이 회원 id를 가리킨다 (글은 "탈퇴한 회원"으로 보인다).
   * 겹침 열쇠 'left:<id>'는 DB CHECK가 나간 줄에만 받는다. 로그인(계정의 것)은 그대로다. 이미 나갔으면 409
   */
  leave(now: Date): void {
    if (this.row.left_at) throw new Conflict('이미 나간 앱이에요');
    this.put('left_at', now);
    this.put('account_id', null);
    this.put('nickname', Member.LEFT_NAME);
    this.put('nickname_key', `left:${this.id}`);
    this.put('block_note', null);
    this.put('renamed_at', null);
    this.put('last_seen_at', null);
  }

  /** 닉네임 바꾸기: 차단 중이면 못 하고, RENAME_DAYS에 한 번. 같은 닉네임이면 그대로 */
  rename(nickname: string, now: Date): void {
    this.assertActive(now);
    const clean = Nickname.clean(nickname);
    if (clean === this.row.nickname) return;
    const last = this.row.renamed_at;
    if (last && now.getTime() - last.getTime() < Member.RENAME_DAYS * Member.DAY_MS)
      throw new RuleViolation(`닉네임은 ${Member.RENAME_DAYS}일에 한 번 바꿀 수 있어요`);
    this.put('nickname', clean);
    this.put('nickname_key', Nickname.keyOf(clean));
    this.put('renamed_at', now);
  }

  /**
   * 관리자의 차단 (3-1c): until까지, 없으면 무기한(FOREVER). 이 앱에서만: 차단 중이면 쓰기 · 신고 · 닉네임 바꾸기가 403이고
   * 로그인 · 읽기 · 자기 글 지우기는 된다 (차단된 것을 내 정보에서 본다). 모든 앱에서 막는 것은 계정 정지(Account.suspend)
   */
  block(until: Date | null, now: Date): void {
    const end = until ?? Member.FOREVER;
    if (end.getTime() <= now.getTime() || end.getTime() > Member.FOREVER.getTime())
      throw new RuleViolation('차단이 끝나는 때는 지금보다 뒤여야 해요');
    this.put('blocked_until', end);
  }

  /** 차단 풀기: 차단 중인 회원만 (아니면 409) */
  unblock(now: Date): void {
    const until = this.row.blocked_until;
    if (!until || until.getTime() <= now.getTime()) throw new Conflict('차단된 회원이 아니에요');
    this.put('blocked_until', null);
  }

  /** 글 · 댓글을 쓰기 전에: 차단 중이면 403, 참여하고 JOIN_WAIT_MS가 지나지 않았으면 422 (스팸 계정이 가입하자마자 쓰지 못하게) */
  assertCanWrite(now: Date): void {
    this.assertActive(now);
    if (now.getTime() - this.row.joined_at.getTime() < Member.JOIN_WAIT_MS)
      throw new RuleViolation(`가입하고 ${Member.JOIN_WAIT_MS / 60_000}분 뒤부터 쓸 수 있어요`);
  }

  /** 쓰기 · 신고 · 닉네임 바꾸기 전에: 차단 중이면 403 (무기한 차단은 FOREVER) */
  assertActive(now: Date): void {
    const until = this.row.blocked_until;
    if (!until || until.getTime() <= now.getTime()) return;
    const day = until.toISOString().slice(0, 10);
    throw new Forbidden(
      'member',
      until.getTime() >= Member.FOREVER.getTime()
        ? '차단된 회원이에요'
        : `차단된 회원이에요 (${day}까지)`,
    );
  }

  /** 관리자 결정 뒤의 회원 (차단 · 풀기) */
  decidedView(): MemberDecidedView {
    return new MemberDecidedView(this.row);
  }

  /** 관리자의 비밀번호 초기화 답 (비밀번호는 계정의 것, 임시 비밀번호는 이 답에 한 번만) */
  resetView(loginId: string | null, password: string): MemberResetView {
    return new MemberResetView(this.row, loginId, password);
  }

  view(): MemberSelfView {
    return new MemberSelfView(
      this.row,
      new Date(this.row.joined_at.getTime() + Member.JOIN_WAIT_MS),
    );
  }
}
