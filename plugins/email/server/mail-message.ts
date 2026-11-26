import { randomUUID } from 'node:crypto';
import { RuleViolation } from '../../../apps/server/src/plugin-api';

// 메일 한 통 (RFC 5322 + MIME). 글은 모두 UTF-8: 제목은 encoded-word(base64), 본문은 text/plain base64.
// 머리글에 들어가는 값은 줄바꿈을 받지 않는다 (머리글을 끼워 넣지 못하게): 주소는 모양을 보고, 제목은 base64로 싼다.
export class MailMessage {
  /** 받는 사람 · 보내는 사람 주소의 모양 (공백 · 꺾쇠 · 줄바꿈 없음) */
  private static readonly ADDRESS =
    /^[^\s@<>()",;:\\[\]]+@[^\s@<>()",;:\\[\]]+\.[^\s@<>()",;:\\[\]]+$/;
  private static readonly ADDRESS_MAX = 254;
  /** encoded-word 하나에 넣는 바이트 ("=?UTF-8?B?" + base64 60자 + "?=" = 72자, 75자 한도 안) */
  private static readonly WORD_BYTES = 45;
  private static readonly LINE = 76;
  private static readonly SUBJECT_MAX = 200;
  private static readonly TEXT_MAX = 20_000;

  constructor(
    readonly from: string,
    readonly to: string,
    readonly subject: string,
    readonly text: string,
    /** 더할 머리글 (해지 링크 List-Unsubscribe 같은 것). 이름은 글자 · 하이픈, 값은 한 줄 */
    readonly headers: readonly (readonly [string, string])[] = [],
  ) {
    MailMessage.assertAddress(from);
    MailMessage.assertAddress(to);
    for (const [name, value] of headers)
      if (!/^[A-Za-z][A-Za-z-]{0,60}$/.test(name) || /[\r\n]/.test(value) || value.length > 500)
        throw new RuleViolation(`머리글 모양이 아니에요: ${name.slice(0, 40)}`);
  }

  static isAddress(value: string): boolean {
    return value.length <= MailMessage.ADDRESS_MAX && MailMessage.ADDRESS.test(value);
  }

  /** SMTP DATA로 보낼 글 (줄 끝 CRLF, 마침표로 시작하는 줄은 두 번) */
  render(name: string, now: Date): string {
    const domain = this.from.split('@')[1] ?? 'localhost';
    const body = Buffer.from(
      this.text.slice(0, MailMessage.TEXT_MAX).replace(/\r?\n/g, '\r\n'),
      'utf8',
    ).toString('base64');
    const lines = [
      `From: ${MailMessage.word(name)} <${this.from}>`,
      `To: <${this.to}>`,
      `Subject: ${MailMessage.words(MailMessage.oneLine(this.subject).slice(0, MailMessage.SUBJECT_MAX))}`,
      `Date: ${now.toUTCString()}`,
      `Message-ID: <${randomUUID()}@${domain}>`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
      'Auto-Submitted: auto-generated',
      ...this.headers.map(([name, value]) => `${name}: ${value}`),
      '',
      ...(body.match(new RegExp(`.{1,${MailMessage.LINE}}`, 'g')) ?? []),
    ];
    return lines.map((l) => (l.startsWith('.') ? `.${l}` : l)).join('\r\n');
  }

  private static assertAddress(value: string): void {
    if (!MailMessage.isAddress(value))
      throw new RuleViolation(`메일 주소 모양이 아니에요: ${value.slice(0, 80)}`);
  }

  /** 줄바꿈 · 제어 문자를 공백으로 */
  private static oneLine(value: string): string {
    // biome-ignore lint/suspicious/noControlCharactersInRegex: 머리글에 제어 문자가 들어가지 않게 지운다
    return value.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
  }

  /** 글을 encoded-word 여러 개로 (글자를 반으로 자르지 않는다), 접어서 잇는다 */
  private static words(value: string): string {
    const parts: string[] = [];
    let current = '';
    for (const char of value) {
      if (Buffer.byteLength(current + char, 'utf8') > MailMessage.WORD_BYTES) {
        parts.push(current);
        current = '';
      }
      current += char;
    }
    if (current || parts.length === 0) parts.push(current);
    return parts.map((p) => MailMessage.word(p)).join('\r\n ');
  }

  private static word(value: string): string {
    return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
  }
}
