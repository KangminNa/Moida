import { createServer, type Server, type Socket } from 'node:net';

// 테스트용 SMTP 서버 (127.0.0.1, TLS 없이). 로그인 · 받는 사람 · DATA를 받아 둔다
export class FakeSmtp {
  /** 받은 메일: 보낸 · 받는 주소와 DATA 원문 */
  readonly mails: { from: string; to: string; data: string }[] = [];
  /** 받은 명령 (AUTH 줄은 앞부분만) */
  readonly commands: string[] = [];

  private constructor(
    private readonly server: Server,
    readonly port: number,
    private readonly user: string,
    private readonly password: string,
  ) {}

  static async start(user: string, password: string): Promise<FakeSmtp> {
    let fake: FakeSmtp | null = null;
    const server = createServer((socket) => fake?.serve(socket));
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const address = server.address();
    fake = new FakeSmtp(
      server,
      typeof address === 'object' && address ? address.port : 0,
      user,
      password,
    );
    return fake;
  }

  close(): void {
    this.server.close();
  }

  private serve(socket: Socket): void {
    let buffer = '';
    let data: string | null = null;
    let from = '';
    let to = '';
    const say = (line: string) => socket.write(`${line}\r\n`);
    say('220 fake.smtp ready');
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      if (data !== null) {
        const end = buffer.indexOf('\r\n.\r\n');
        if (end < 0) return;
        this.mails.push({ from, to, data: buffer.slice(0, end) });
        buffer = buffer.slice(end + 5);
        data = null;
        say('250 queued');
      }
      let end = buffer.indexOf('\r\n');
      while (end >= 0 && data === null) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        this.commands.push(line.startsWith('AUTH') ? 'AUTH' : line);
        if (line.startsWith('EHLO')) socket.write('250-fake.smtp\r\n250 AUTH PLAIN LOGIN\r\n');
        else if (line.startsWith('AUTH PLAIN ')) {
          const [, user, password] = Buffer.from(line.slice(11), 'base64')
            .toString()
            .split('\u0000');
          say(
            user === this.user && password === this.password
              ? '235 ok'
              : '535 5.7.8 bad credentials',
          );
        } else if (line.startsWith('MAIL FROM:')) {
          from = line.slice(10).replace(/[<>]/g, '');
          say('250 ok');
        } else if (line.startsWith('RCPT TO:')) {
          to = line.slice(8).replace(/[<>]/g, '');
          say(to.endsWith('@blocked.example') ? '550 5.1.1 no such user' : '250 ok');
        } else if (line === 'DATA') {
          data = '';
          say('354 go');
        } else if (line === 'QUIT') {
          say('221 bye');
          socket.end();
        } else say('500 unknown');
        end = buffer.indexOf('\r\n');
      }
    });
  }
}
