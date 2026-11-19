import { BaseEntity, RuleViolation, TableEntity } from '../../platform';
import type { OutputShareNew, OutputShareRow } from '../task.tables';

// 결과물 공유 링크 하나 (task.output_shares, 기획서 결정 2026-11-19). 관리자가 결과물 하나를 로그인 없이 볼 수 있게 기간을 정해 연다.
// 기간은 1 · 7 · 30일 중 하나. 끄면 바로 닫히고 다시 열지 않는다 (새로 만든다). 링크의 토큰은 저장하지 않는다 (ShareLink).
// AI는 공유 링크를 만들지 못한다: 바깥 공유는 외부 전송이라 관리자만 (원칙 7)
export class OutputShare extends TableEntity<OutputShareRow, OutputShareNew> {
  static readonly DAYS: readonly number[] = [1, 7, 30];
  private static readonly DAY_MS = 86_400_000;

  static open(spaceId: string, outputId: string, days: number, now: Date): OutputShare {
    if (!OutputShare.DAYS.includes(days))
      throw new RuleViolation(`기간은 ${OutputShare.DAYS.join(' · ')}일 중 하나예요`);
    return new OutputShare(
      {
        id: BaseEntity.newId(),
        space_id: spaceId,
        output_id: outputId,
        expires_at: new Date(now.getTime() + days * OutputShare.DAY_MS),
        created_at: now,
      },
      true,
    );
  }

  static restore(row: OutputShareRow): OutputShare {
    return new OutputShare(row);
  }

  /** 끈다. 이미 꺼졌으면 그대로 (기간이 지난 링크도 끌 수 있다) */
  end(now: Date): void {
    if (this.row.ended_at === null || this.row.ended_at === undefined) this.put('ended_at', now);
  }
}
