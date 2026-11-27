import { BaseMailer, TooManyRequests } from '../../../apps/server/src/plugin-api';
import { MailMessage } from './mail-message';
import { NoticeMail } from './notice-mail';
import type { SmtpGateway } from './smtp.gateway';
import type { MailGate } from './usage';

// 코어의 확인 메일(가입 · 비밀번호 다시 정하기의 인증코드)을 이 SMTP로 보낸다 (플러그인 API 0.14, 2026-11-26).
// 글은 코어가 정하고, 여기서는 보내는 계정 · 메일 모양만 붙인다. 보내기 전에 메일 사용량(email.usage)의 한도를 본다
// (2026-11-27): 인증코드는 하루 · 한 달 상한을 끝까지 쓸 수 있고(여러 명에게 가는 소식은 80%까지), 닿으면 보내지 않는다
export class CodeMailer extends BaseMailer {
  constructor(
    private readonly smtp: SmtpGateway,
    private readonly from: string,
    private readonly gate: MailGate,
  ) {
    super();
  }

  async send(to: string, subject: string, text: string): Promise<void> {
    if (!(await this.gate.take('code')))
      throw new TooManyRequests('메일 한도에 닿아 확인 메일을 보내지 못했어요');
    await this.smtp.send(
      new MailMessage(this.from, to, subject, text),
      NoticeMail.NAME,
      new Date(),
    );
  }
}
