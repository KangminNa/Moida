import { Conflict, Database, type Row, TableRepository } from '../../platform';
import { members } from '../community.schema';
import type { MemberRow } from '../community.tables';
import { Member } from './member';

// community.members ↔ Member. 회원은 공간이 아니라 앱에 든다: load · lock의 첫 값은 앱 id다.
// 닉네임 · 같은 계정의 두 번째 참여가 겹치면 DB가 막고 409로 바꾼다
export class MemberRepository extends TableRepository<MemberRow, Member> {
  protected readonly table = members;
  protected readonly noun = '회원';

  protected toEntity(row: MemberRow): Member {
    return Member.restore(row);
  }

  protected override select(appId: string, id: string, lock: boolean): Promise<readonly Row[]> {
    return this.rows(members, { id, app_id: appId }, { lock });
  }

  override async save(member: Member): Promise<void> {
    try {
      await super.save(member);
    } catch (error) {
      if (Database.isUniqueViolation(error, 'members_nickname_key'))
        throw new Conflict('이미 쓰는 닉네임이에요');
      if (Database.isUniqueViolation(error, 'members_account_key'))
        throw new Conflict('이미 참여한 앱이에요');
      throw error;
    }
  }

  /** 계정이 그 앱에 참여한 회원 (나가면 연결을 끊어 찾히지 않는다) */
  findOfAccount(appId: string, accountId: string, lock = false): Promise<Member | null> {
    return this.findOne({ app_id: appId, account_id: accountId }, { lock });
  }

  /** 계정이 참여한 모든 앱의 회원 (계정 탈퇴가 모두 나간다). 잠근다 */
  async lockAllOfAccount(accountId: string): Promise<Member[]> {
    return this.find({ account_id: accountId }, { lock: true, order: ['id'] });
  }
}
