import { type Row, TableRepository } from '../../platform';
import { decisions } from '../community.schema';
import type { DecisionRow } from '../community.tables';
import { Decision } from './decision';

// community.decisions ↔ Decision. 추가만 한다 (DB 트리거가 고치기 · 지우기를 막는다). load의 첫 값은 앱 id다
export class DecisionRepository extends TableRepository<DecisionRow, Decision> {
  protected readonly table = decisions;
  protected readonly noun = '결정 기록';

  protected toEntity(row: DecisionRow): Decision {
    return Decision.restore(row);
  }

  protected override select(appId: string, id: string, lock: boolean): Promise<readonly Row[]> {
    return this.rows(decisions, { id, app_id: appId }, { lock });
  }
}
