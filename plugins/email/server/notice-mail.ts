import { MailMessage } from './mail-message';

// 관리자에게 가는 알림 메일의 모양 (2026-11-26). 메일 회사를 거치므로 제목과 콘솔 링크만 싣고,
// 본문은 관리자가 "알림 본문도 싣기"를 켰을 때만. 승인 단추는 두지 않는다 (승인은 콘솔에서, 원칙 7).
export class NoticeMail {
  /** 보내는 사람 이름 */
  static readonly NAME = 'Cairn';

  constructor(
    /** 보내는 계정 */
    readonly from: string,
    /** 받는 관리자 (비우면 보내는 계정) */
    readonly to: string,
    /** 콘솔 링크의 앞부분 (https://…, 끝의 / 없음) */
    readonly site: string,
    /** 알림 본문도 싣는가 */
    readonly detail: boolean,
  ) {}

  /** 설정 칸에서. 보내는 계정 · 받는 주소의 모양이 틀리면 null (보내지 않는다) */
  static of(settings: { get(key: string): string | undefined }): NoticeMail | null {
    const from = (settings.get('user') ?? '').trim();
    const to = (settings.get('to') ?? '').trim() || from;
    const site = (settings.get('siteUrl') ?? '').trim().replace(/\/+$/, '');
    if (!MailMessage.isAddress(from) || !MailMessage.isAddress(to)) return null;
    if (!/^https?:\/\/[^/\s]+$/.test(site)) return null;
    return new NoticeMail(from, to, site, settings.get('detail') === 'true');
  }

  /** 알림 하나의 메일. 링크는 이 Cairn 안의 경로만 (아니면 콘솔 첫 화면) */
  notice(title: string, body: string, link: string): MailMessage {
    const path = /^\/(?!\/)[^\s]*$/.test(link) ? link : '/admin';
    const lines = [title, ...(this.detail && body ? ['', body] : []), '', `${this.site}${path}`];
    lines.push('', '알림 설정은 콘솔 › 설정 › 알림에서 바꿔요.');
    return new MailMessage(this.from, this.to, `[Cairn] ${title}`, lines.join('\n'));
  }

  /** 설정을 마친 뒤 확인하는 메일 */
  test(): MailMessage {
    return new MailMessage(
      this.from,
      this.to,
      '[Cairn] 테스트 메일',
      ['이 메일이 보이면 알림 메일 설정을 마쳤어요.', '', `${this.site}/admin`].join('\n'),
    );
  }
}
