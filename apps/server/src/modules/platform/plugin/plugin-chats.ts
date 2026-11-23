import { Injectable } from '@nestjs/common';
import type { Sql } from '../base/database';

/** 기능 패키지가 대화에 보낸 말의 결과: 어느 대화 · 몇 번째 회차인지, 덧붙인 말이었는지 */
export class ChatSent {
  constructor(
    readonly chatId: string,
    /** 대화의 회차 수 (보낸 말이 연 회차, 덧붙인 말이면 지금 도는 회차) */
    readonly turn: number,
    /** 끝나지 않은 회차에 덧붙인 말이었는가 */
    readonly appended: boolean,
  ) {}
}

/** 등록하는 쪽이 주는 보내기: 기능 패키지의 트랜잭션에서 */
type Sender = (
  sql: Sql,
  spaceId: string,
  chatId: string | null,
  requestId: string,
  text: string,
) => Promise<ChatSent>;

// 기능 패키지의 대화 입구 (플러그인 API 0.10, 2026-11-23 텔레그램): 메신저 패키지가 관리자가 이어 둔 계정에서 온 말을
// 관리자의 대화에 넣는다. 대화를 가진 모듈(task)이 시작할 때 보내기를 등록하고, 패키지는 목록 파일의 uses에 chat이 있을 때만
// work.sendChat으로 부른다 (켤 때 관리자가 허락한다). platform은 누가 등록하는지 모른다 (Leases와 같은 방식).
// 결재는 이 길로 하지 못한다: 대화에 말만 넣고, 승인 · 반려는 콘솔에서 한다 (원칙 7).
@Injectable()
export class PluginChats {
  private sender: Sender | null = null;

  /** 대화를 가진 모듈이 한 번 등록한다 */
  register(sender: Sender): void {
    if (this.sender) throw new Error('대화 입구는 한 곳만 등록해요');
    this.sender = sender;
  }

  /**
   * 공간의 대화에 말 하나 (부르는 쪽의 트랜잭션에서). chatId가 없거나 그 대화가 없거나 휴지통이면 새 대화.
   * 같은 requestId는 한 번만. 등록한 모듈이 없으면 오류 (서버 구성이 틀렸다)
   */
  send(
    sql: Sql,
    spaceId: string,
    chatId: string | null,
    requestId: string,
    text: string,
  ): Promise<ChatSent> {
    if (!this.sender) throw new Error('대화 입구를 등록한 모듈이 없어요');
    return this.sender(sql, spaceId, chatId, requestId, text);
  }
}
