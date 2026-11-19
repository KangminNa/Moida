import type { OutputShareRow } from '../task.tables';

// 결과물 공유 링크의 읽기 모양 (관리자만). 웹이 `import type`으로 가져온다.
// path는 공개 주소(/share/<토큰>)다: 토큰은 저장하지 않고 읽을 때마다 서버 키로 다시 만든다 (ShareLink)

/** 공유 링크 한 줄과 그 결과물의 이름 */
export type OutputShareLine = OutputShareRow & { output_name: string };

/** 공유 링크 하나 */
export class OutputShareView {
  constructor(
    private readonly row: Readonly<OutputShareLine>,
    private readonly path: string,
    private readonly now: Date,
  ) {}

  toJSON() {
    const r = this.row;
    return {
      id: r.id,
      outputId: r.output_id,
      outputName: r.output_name,
      path: this.path,
      expiresAt: r.expires_at.toISOString(),
      endedAt: r.ended_at?.toISOString() ?? null,
      createdAt: r.created_at.toISOString(),
      /** 지금 열리는가 (끄지 않았고 기간 안) */
      live: r.ended_at === null && r.expires_at.getTime() > this.now.getTime(),
    };
  }
}

/** 살아 있는 공유 링크 목록 */
export class OutputShareListView {
  constructor(private readonly shares: readonly OutputShareView[]) {}

  toJSON() {
    return { shares: this.shares.map((s) => s.toJSON()) };
  }
}
