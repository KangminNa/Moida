import type { Duplex } from 'node:stream';
import { connect } from 'node:tls';
import { BaseGateway } from '../../../apps/server/src/plugin-api';
import type { MailMessage } from './mail-message';

/** 메일 서버에 붙는 길. 운영은 TLS(465), 테스트는 테스트용 SMTP 서버로 바로 */
export type SmtpOpen = (host: string, port: number) => Duplex;

/** 메일 서버의 답 한 개: 세 자리 번호와 글 (여러 줄이면 이어 붙인다) */
class SmtpReply {
  constructor(
    readonly code: number,
    readonly text: string,
  ) {}
}

/** 붙은 연결 하나: 명령을 보내고 답을 한 개씩 받는다 */
class SmtpSession {
  private buffer = '';
  private lines: string[] = [];
  private waiting: ((reply: SmtpReply | Error) => void) | null = null;
  private failed: Error | null = null;

  constructor(private readonly socket: Duplex) {
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => this.receive(chunk));
    socket.on('error', (error) => this.fail(error));
    socket.on('close', () => this.fail(new Error('메일 서버가 연결을 끊었어요')));
  }

  /** 다음 답. want가 아니면 오류 (번호와 메일 서버의 글) */
  async expect(want: number): Promise<void> {
    const reply = await new Promise<SmtpReply | Error>((resolve) => {
      if (this.failed) resolve(this.failed);
      else this.waiting = resolve;
      this.flush();
    });
    if (reply instanceof Error) throw reply;
    if (reply.code !== want) throw SmtpGateway.problem(reply.code, reply.text);
  }

  async command(line: string, want: number): Promise<void> {
    this.socket.write(`${line}\r\n`);
    return this.expect(want);
  }

  close(): void {
    this.socket.destroy();
  }

  private receive(chunk: string): void {
    this.buffer += chunk;
    let end = this.buffer.indexOf('\r\n');
    while (end >= 0) {
      this.lines.push(this.buffer.slice(0, end));
      this.buffer = this.buffer.slice(end + 2);
      end = this.buffer.indexOf('\r\n');
    }
    this.flush();
  }

  /** 마지막 줄(번호 뒤가 공백)까지 왔으면 기다리는 쪽에 답 하나를 넘긴다 */
  private flush(): void {
    if (!this.waiting) return;
    const last = this.lines.findIndex((l) => /^\d{3}(?: |$)/.test(l));
    if (last < 0) return;
    const taken = this.lines.splice(0, last + 1);
    const done = this.waiting;
    this.waiting = null;
    done(
      new SmtpReply(
        Number(taken[last]?.slice(0, 3)),
        taken
          .map((l) => l.slice(4))
          .join(' ')
          .slice(0, 300),
      ),
    );
  }

  private fail(error: Error): void {
    this.failed ??= error;
    const done = this.waiting;
    this.waiting = null;
    done?.(this.failed);
  }
}

// 메일 서버(SMTP)로 한 통 보내기 (2026-11-26, Gmail 앱 비밀번호). 라이브러리 없이 node:tls로:
// 465 포트에 TLS로 바로 붙고(인증서는 Node의 기본 검사), EHLO → AUTH PLAIN → MAIL → RCPT → DATA → QUIT.
// 평문으로 붙었다 올리는 587(STARTTLS)은 쓰지 않는다 (올리기 전 글이 보이고, 올리기를 빼먹게 하는 공격이 있다).
// 비밀번호는 AUTH 한 줄에만 들어가고 오류 글에는 메일 서버의 번호와 글만 싣는다.
export class SmtpGateway extends BaseGateway {
  protected readonly name = '메일 서버';
  protected override readonly timeoutMs = 20_000;

  constructor(
    private readonly host: string,
    private readonly port: number,
    private readonly user: string,
    private readonly password: string,
    private readonly open: SmtpOpen = (host, port) => connect({ host, port, servername: host }),
  ) {
    super();
  }

  /**
   * 설정 칸의 SMTP 서버를 호스트 이름만으로 (2026-11-26): "https://mail.example.com/" · "smtps://…:465"처럼
   * 주소째 넣어도 이름만 남긴다. 그대로 넘기면 DNS가 "https://…"를 찾다 ENOTFOUND로 실패한다
   */
  static hostOf(raw: string): string {
    const name = raw
      .trim()
      .replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
      .split(/[/?#]/)[0]
      ?.replace(/:\d+$/, '')
      .toLowerCase();
    return name || 'smtp.gmail.com';
  }

  /** 메일 서버가 거절한 답을 알아볼 수 있는 글로 (535: 로그인 거절) */
  static problem(code: number, text: string): Error {
    if (code === 535 || code === 534)
      return new Error(
        `로그인을 거절했어요 (${code}). 계정 비밀번호가 아니라 앱 비밀번호를 넣어요`,
      );
    return new Error(`${code} ${text}`.trim());
  }

  async send(message: MailMessage, name: string, now: Date): Promise<void> {
    await this.call(async (signal) => {
      const session = new SmtpSession(this.open(this.host, this.port));
      const stop = () => session.close();
      signal.addEventListener('abort', stop, { once: true });
      try {
        await session.expect(220);
        await session.command('EHLO cairn', 250);
        const plain = Buffer.from(`\u0000${this.user}\u0000${this.password}`, 'utf8');
        await session.command(`AUTH PLAIN ${plain.toString('base64')}`, 235);
        await session.command(`MAIL FROM:<${message.from}>`, 250);
        await session.command(`RCPT TO:<${message.to}>`, 250);
        await session.command('DATA', 354);
        await session.command(`${message.render(name, now)}\r\n.`, 250);
        await session.command('QUIT', 221).catch(() => undefined);
      } finally {
        signal.removeEventListener('abort', stop);
        session.close();
      }
    });
  }
}
