import { Conflict, Database, type Row, TableRepository } from '../../platform';
import { terms } from '../community.schema';
import type { TermKind, TermRow } from '../community.tables';
import { Term } from './term';

// community.terms ↔ Term (스토어 3-4). 추가만 하는 표라 새 줄만 넣는다 (트리거가 UPDATE · DELETE를 막는다).
// 같은 앱 · 종류 · 번호는 DB가 막는다: 두 관리자 · 승인이 같은 버전을 보고 올리면 하나만 들어가고 나머지는 409
export class TermRepository extends TableRepository<TermRow, Term> {
  protected readonly table = terms;
  protected readonly noun = '약관';

  protected toEntity(row: TermRow): Term {
    return Term.restore(row);
  }

  protected override select(appId: string, id: string, lock: boolean): Promise<readonly Row[]> {
    return this.rows(terms, { id, app_id: appId }, { lock });
  }

  override async save(term: Term): Promise<void> {
    try {
      await super.save(term);
    } catch (error) {
      if (Database.isUniqueViolation(error, 'terms_version_key'))
        throw new Conflict('그사이 약관의 새 버전이 올라왔어요. 다시 읽고 고쳐 주세요');
      throw error;
    }
  }

  /** 앱 · 종류의 마지막(공개된) 버전 */
  latest(appId: string, kind: TermKind): Promise<Term | null> {
    return this.findOne({ app_id: appId, kind }, { order: ['version desc'], limit: 1 });
  }
}
