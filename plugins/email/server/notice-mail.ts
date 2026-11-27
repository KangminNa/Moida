import { MailMessage } from './mail-message';

// 관리자에게 가는 알림 메일의 모양 (2026-11-26). 메일 회사를 거치므로 제목과 콘솔 링크만 싣고,
// 본문은 관리자가 "알림 본문도 싣기"를 켰을 때만. 승인 단추는 두지 않는다 (승인은 콘솔에서, 원칙 7).
export class NoticeMail {
  /** 보내는 사람 이름 */
  static readonly NAME = 'Moida';

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
    return new MailMessage(this.from, this.to, `[Moida] ${title}`, lines.join('\n'));
  }

  /**
   * 자동화 회차의 답 · 실패 (2026-11-27, 메일로 받기를 켠 레시피만). 답은 앞부분(코어가 자른 3500자)을 싣고
   * 전체 · 결과물은 대화와 정리한 HTML 링크로. chatId는 UUID만 (아니면 콘솔 첫 화면)
   */
  answer(chatId: string, title: string, failed: boolean, text: string): MailMessage {
    const name = title.trim() || '자동화';
    const chat = /^[0-9a-f-]{36}$/i.test(chatId) ? `/admin/chats/${chatId}` : '/admin';
    const lines = [
      failed ? `못 했어요 · ${name}` : name,
      '',
      text,
      '',
      ...(failed ? [] : [`정리한 HTML: ${this.site}${chat}/report`]),
      `대화: ${this.site}${chat}`,
      '',
      '이 메일은 자동화의 "메일로 받기"를 켜서 왔어요. 끄려면 콘솔 › 자동화에서 바꿔요.',
    ];
    const subject = failed ? `[Moida] 못 했어요 · ${name}` : `[Moida] ${name}`;
    return new MailMessage(this.from, this.to, subject, lines.join('\n'));
  }

  /** 구독 확인 메일 (두 번 확인): 스토어 화면의 확인 단추로 가는 링크. 신청하지 않았으면 무시하면 7일 뒤 지워진다 */
  confirm(address: string, token: string, apps: readonly string[]): MailMessage {
    const names = apps.join(', ');
    return new MailMessage(
      this.from,
      address,
      `[${names}] 구독 확인`,
      [
        `${names}의 새 글을 메일로 받으려면 아래 링크에서 구독을 확인해 주세요.`,
        '',
        `${this.site}/store?mail=confirm&token=${token}`,
        '',
        '신청하지 않았다면 이 메일을 무시하세요. 확인하지 않은 신청은 7일 뒤 지워져요.',
      ].join('\n'),
    );
  }

  /** 새 글 소식: 글 링크와 해지 링크 (본문 · 원클릭 해지 머리글 RFC 8058) */
  post(address: string, token: string, app: string, title: string, link: string): MailMessage {
    return new MailMessage(
      this.from,
      address,
      `[${app}] ${title}`,
      [
        `${app}에 새 글이 올라왔어요.`,
        '',
        title,
        link,
        '',
        `그만 받으려면: ${this.site}/store?mail=unsubscribe&token=${token}`,
      ].join('\n'),
      [
        ['List-Unsubscribe', `<${this.site}/api/p/email/unsubscribe/${token}>`],
        ['List-Unsubscribe-Post', 'List-Unsubscribe=One-Click'],
      ],
    );
  }

  /** 설정을 마친 뒤 확인하는 메일 */
  test(): MailMessage {
    return new MailMessage(
      this.from,
      this.to,
      '[Moida] 테스트 메일',
      ['이 메일이 보이면 알림 메일 설정을 마쳤어요.', '', `${this.site}/admin`].join('\n'),
    );
  }
}
