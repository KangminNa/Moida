import { Injectable, Logger } from '@nestjs/common';
import { ExternalFailure } from '../base/errors';
import { PluginRegistry } from './plugin-registry';

// 코어가 보내는 확인 메일 (2026-11-26, 메일 인증 가입 · 비밀번호 다시 정하기). 보내는 길은 메일 플러그인이 등록한 것(BaseMailer).
// 보내기를 기다리지 않는다: 답하는 시간으로 가입한 주소인지 드러나지 않게, 그리고 메일 회사가 느려도 화면이 붙잡히지 않게.
// 실패는 서버 로그에만 남긴다 (받는 주소는 적지 않는다)
@Injectable()
export class CodeMail {
  private readonly logger = new Logger('확인 메일');

  constructor(private readonly plugins: PluginRegistry) {}

  /** 메일을 보낼 수 없으면(메일 플러그인이 꺼져 있거나 설정 전) 그 일을 막는다 */
  assertReady(): void {
    if (!this.plugins.mailer())
      throw new ExternalFailure('메일을 보낼 수 없어요. 메일 플러그인 설정이 필요해요');
  }

  /** 한 통을 보낸다 (기다리지 않는다) */
  post(to: string, subject: string, text: string): void {
    const mailer = this.plugins.mailer();
    if (!mailer) return;
    void mailer
      .send(to, subject, text)
      .catch((error: unknown) =>
        this.logger.error(`확인 메일을 보내지 못했어요: ${String(error).slice(0, 300)}`),
      );
  }
}
