import { BaseHandler, type DomainEvent } from '../../../apps/server/src/plugin-api';
import { NoticeMail } from './notice-mail';
import type { SmtpGateway } from './smtp.gateway';

// platform.notice.sent를 받아 관리자에게 메일 한 통 (일꾼, 트랜잭션 밖). 푸시와 같은 때 · 같은 묶음이다:
// 조용한 시간 · 묶음 시각 · 종류마다의 경로(push만)는 코어의 알림 설정이 정한다.
// 실패하면 일꾼이 다시 시도한다: 메일 서버가 받았는데 답을 놓치면 같은 메일이 두 번 갈 수 있다 (빠지는 것보다 낫다).
export class NoticeSentHandler extends BaseHandler {
  static readonly TOPIC = 'platform.notice.sent';

  constructor(
    private readonly smtp: SmtpGateway | null,
    private readonly mail: NoticeMail | null,
  ) {
    super();
  }

  async handle(event: DomainEvent): Promise<void> {
    if (event.name !== NoticeSentHandler.TOPIC || !this.smtp || !this.mail) return;
    const { title, body, link } = event.data as { title?: unknown; body?: unknown; link?: unknown };
    if (typeof title !== 'string' || !title) return;
    const message = this.mail.notice(
      title,
      typeof body === 'string' ? body : '',
      typeof link === 'string' ? link : '',
    );
    await this.smtp.send(message, NoticeMail.NAME, new Date());
  }
}
