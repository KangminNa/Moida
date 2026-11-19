import { TableRepository } from '../../platform';
import { outputShares } from '../task.schema';
import type { OutputShareRow } from '../task.tables';
import { OutputShare } from './output-share';

// task.output_shares ↔ OutputShare. 불러오기 · 잠그기 · 저장(바뀐 칸만, version으로 늦은 쓰기를 막는다)은 기반이 한다
export class OutputShareRepository extends TableRepository<OutputShareRow, OutputShare> {
  protected readonly table = outputShares;
  protected readonly noun = '공유 링크';

  protected toEntity(row: OutputShareRow): OutputShare {
    return OutputShare.restore(row);
  }
}
