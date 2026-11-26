import { BaseMailer, TooManyRequests } from '../../../apps/server/src/plugin-api';
import { MailMessage } from './mail-message';
import { NoticeMail } from './notice-mail';
import type { SmtpGateway } from './smtp.gateway';

// 코어의 확인 메일(가입 · 비밀번호 다시 정하기의 인증코드)을 이 SMTP로 보낸다 (플러그인 API 0.14, 2026-11-26).
// 글은 코어가 정하고, 여기서는 보내는 계정 · 메일 모양만 붙인다. 하루 상한(dailyMax)을 넘으면 보내지 않는다:
// 메일 회사의 하루 한도(Gmail 약 500통)를 확인 메일이 다 쓰면 관리자 알림 · 소식까지 막히므로 서버 메모리에서 따로 센다
export class CodeMailer extends BaseMailer {
  private day = '';
  private sent = 0;

  constructor(
    private readonly smtp: SmtpGateway,
    private readonly from: string,
    private readonly dailyMax: number,
  ) {
    super();
  }

  async send(to: string, subject: string, text: string): Promise<void> {
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    if (today !== this.day) {
      this.day = today;
      this.sent = 0;
    }
    if (this.sent >= this.dailyMax)
      throw new TooManyRequests('오늘 보낼 수 있는 확인 메일을 다 썼어요');
    this.sent += 1;
    await this.smtp.send(new MailMessage(this.from, to, subject, text), NoticeMail.NAME, now);
  }
}
