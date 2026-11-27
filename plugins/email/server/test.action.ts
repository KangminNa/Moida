import {
  ActionResult,
  type Actor,
  BaseAction,
  ExternalFailure,
} from '../../../apps/server/src/plugin-api';
import { NoticeMail } from './notice-mail';
import type { SmtpGateway } from './smtp.gateway';
import type { MailGate } from './usage';

// 테스트 메일: 설정을 채운 뒤 한 번 눌러 메일 서버 로그인 · 받는 주소를 확인한다
export class TestAction extends BaseAction {
  readonly label = '테스트 메일 보내기';

  constructor(
    private readonly smtp: SmtpGateway | null,
    private readonly mail: NoticeMail | null,
    private readonly gate: MailGate,
  ) {
    super();
  }

  async run(actor: Actor): Promise<ActionResult> {
    actor.assertOwner();
    if (!this.smtp || !this.mail)
      return ActionResult.failed(
        '보내는 계정 · 앱 비밀번호 · 바깥 주소를 먼저 채워요 (주소는 메일 주소 · https:// 모양)',
      );
    if (!(await this.gate.take('test')))
      return ActionResult.failed('오늘(또는 이번 달) 메일 한도에 닿았어요. 설정의 상한을 확인해요');
    try {
      await this.smtp.send(this.mail.test(), NoticeMail.NAME, new Date());
    } catch (error) {
      if (error instanceof ExternalFailure) return ActionResult.failed(error.message);
      throw error;
    }
    return ActionResult.done(`${this.mail.to}로 보냈어요`, [
      '받은편지함(없으면 스팸함)을 확인해요',
    ]);
  }
}
