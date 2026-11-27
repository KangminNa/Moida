import { BaseHandler, type DomainEvent } from '../../../apps/server/src/plugin-api';
import { NoticeMail } from './notice-mail';
import type { SmtpGateway } from './smtp.gateway';

// 자동화 결과를 메일로 (2026-11-27, 사용자 "대화에서 이메일로 보내달라는 스케줄은 설정 못하나?").
// 코어가 "메일로 받기"를 켠 자동화 레시피의 회차에만 task.chat.said에 mail: true를 싣는다.
// 그 회차의 최종 답 · 실패를 관리자(받을 주소) 한 사람에게 한 통 (일꾼, 트랜잭션 밖). 다른 사람에게 보내는 길이 아니다.
// 관리자가 레시피에서 고른 것이라 "알림 본문도 싣기"와 상관없이 답을 싣는다. 결과물 · 승인은 콘솔 링크로 (원칙 7)
export class ChatSaidHandler extends BaseHandler {
  static readonly TOPIC = 'task.chat.said';

  constructor(
    private readonly smtp: SmtpGateway | null,
    private readonly mail: NoticeMail | null,
  ) {
    super();
  }

  async handle(event: DomainEvent): Promise<void> {
    if (event.name !== ChatSaidHandler.TOPIC || !this.smtp || !this.mail) return;
    const { chatId, title, kind, text, mail } = event.data as Record<string, unknown>;
    if (mail !== true || typeof chatId !== 'string' || typeof text !== 'string') return;
    if (kind !== 'final' && kind !== 'failed') return;
    const message = this.mail.answer(
      chatId,
      typeof title === 'string' ? title : '',
      kind === 'failed',
      text,
    );
    await this.smtp.send(message, NoticeMail.NAME, new Date());
  }
}
