import { Approval } from './approval';

/** 관리자가 대화에서 한 요청의 범위: ship은 앱을 공개로 바꾸고 새 버전도 반영, edit은 새 버전만 반영 */
export type OwnerAskScope = 'ship' | 'edit';

// 앱의 결재를 여는 곳 (Approval.open을 쓴다, approval.ts가 300줄을 넘지 않게 나눴다).
//   앱 코드 공개 (스토어 1-6b): 대화의 만들기 일이 낸 확인 대기 버전. 결과 카드에 실려 관리자가 고른다
//   대화의 요청 (2026-11-24, 원칙 7의 예외): 관리자가 대화에 "배포해줘" · "고쳐줘"처럼 쓴 말을 대표가 그대로 인용하면(OwnerAsk가 확인)
//     바로 승인으로 남는다. blog가 받아 앱을 공개로 바꾸고(ship), 같은 대화에서 그 앱의 새 버전은 기다리지 않고 반영된다
// biome-ignore lint/complexity/noStaticOnlyClass: 상태 없는 결재 만들기 한 곳
export class AppApproval {
  /** 요청이 유효한 시간: 이 안에 같은 대화에서 나온 그 앱의 새 버전은 바로 반영된다 */
  static readonly ASK_HOURS = 24;

  /**
   * 대화의 만들기 일이 낸 앱 코드의 확인 대기 버전 (서버가 올린다): 그 대화의 결과 카드에 실려
   * 고르면 그 버전이 공개된다. 작업은 이미 끝나 작업에 묶이지 않는다. 대상은 앱, 판은 버전 번호
   */
  static forAppCode(
    spaceId: string,
    chatId: string,
    agentId: string,
    target: { appId: string; name: string; seq: number },
    now: Date,
  ): Approval {
    return Approval.open(
      {
        space_id: spaceId,
        task_id: null,
        agent_id: agentId,
        action: Approval.APP_CODE_SHOW,
        target_kind: 'app',
        target_id: target.appId,
        target_version: target.seq,
        note: `${target.name} 버전 ${target.seq}`.slice(0, 4000),
        chat_id: chatId,
      },
      now,
    );
  }

  /** 관리자가 대화에서 요청한 앱 공개 · 반영: 대표가 인용한 말과 범위를 payload에 남기고 바로 승인한다 */
  static ownerAsked(
    spaceId: string,
    chatId: string,
    leadId: string,
    appId: string,
    ask: { quote: string; scope: OwnerAskScope },
    now: Date,
  ): Approval {
    const approval = Approval.open(
      {
        space_id: spaceId,
        task_id: null,
        agent_id: leadId,
        action: Approval.PUBLISH_APP,
        target_kind: 'app',
        target_id: appId,
        target_version: 0,
        note: null,
        chat_id: chatId,
        payload: { quote: ask.quote, scope: ask.scope },
      },
      now,
    );
    approval.grantAsked(leadId, ask.quote, now);
    return approval;
  }

  /** 요청이 유효한 마지막 시각 */
  static askedSince(now: Date): Date {
    return new Date(now.getTime() - AppApproval.ASK_HOURS * 3_600_000);
  }
}
