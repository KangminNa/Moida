/** ask_lead의 답: 질문을 남겼고 이 실행은 여기서 끝낸다. lead_woken: 기다리던 대표를 깨웠는가 */
export class LeadAskedView {
  constructor(private readonly leadWoken: boolean) {}

  toJSON() {
    return { asked: true, waiting: true, lead_woken: this.leadWoken };
  }
}

/** reply_worker의 답: 답한 일꾼 수. 대표는 다시 하위 작업을 기다리고 이 실행은 여기서 끝낸다 */
export class WorkersRepliedView {
  constructor(private readonly replied: number) {}

  toJSON() {
    return { replied: this.replied, waiting: true };
  }
}
