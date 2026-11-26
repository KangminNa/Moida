import assert from 'node:assert/strict';
import { BaseMailer, PluginRegistry } from '../modules/platform';
import type { ApiClient } from './api-client';

/** 보낸 메일 한 통 */
export class SentMail {
  constructor(
    readonly to: string,
    readonly subject: string,
    readonly text: string,
  ) {}
}

// 테스트의 메일함 (2026-11-26, 메일 인증 가입): 메일 플러그인 대신 코어의 확인 메일을 받아 둔다.
// 띄운 서버의 PluginRegistry가 이것을 메일 길로 주게 바꾼다 (테스트에서만, 메일 플러그인을 켜지 않아도 되게)
export class TestMailbox extends BaseMailer {
  readonly sent: SentMail[] = [];

  /** 이 서버의 메일 길을 이 메일함으로. 한 서버에 한 번 */
  static install(api: ApiClient): TestMailbox {
    const box = new TestMailbox();
    // PluginRegistry는 팩토리로 만들어 생성자가 공개돼 있지 않다 (서비스 찾기의 타입만 맞춘다)
    const registry = api.service(PluginRegistry as unknown as new () => PluginRegistry);
    registry.mailer = () => box;
    return box;
  }

  async send(to: string, subject: string, text: string): Promise<void> {
    this.sent.push(new SentMail(to, subject, text));
  }

  /** 그 주소로 온 메일 */
  to(address: string): SentMail[] {
    return this.sent.filter((m) => m.to === address);
  }

  /** 그 주소로 온 마지막 메일의 인증코드 (6자리) */
  codeFor(address: string): string {
    const last = this.to(address).at(-1);
    const code = last ? /(\d{6})/.exec(last.text)?.[1] : undefined;
    assert.ok(code, `${address}로 온 인증코드가 없어요`);
    return code;
  }
}
