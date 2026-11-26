import { BasePlugin, type PluginContext } from '../../../apps/server/src/plugin-api';
import { NoticeMail } from './notice-mail';
import { NoticeSentHandler } from './notice-sent.handler';
import { SmtpGateway } from './smtp.gateway';
import { TestAction } from './test.action';

// 알림 메일 (2026-11-26, 기획서 결정): 콘솔의 알림을 관리자의 메일로도 보낸다.
// 코어의 알림이 푸시로 보내기로 정한 것(platform.notice.sent)을 받아 메일 회사의 SMTP(465, TLS)로 한 통씩.
// 메일 서버를 직접 띄우지 않는다 (가정용 회선 · DuckDNS로는 보낸 메일이 닿지 않는다). docs/이메일.md
export default class EmailPlugin extends BasePlugin {
  register(cairn: PluginContext): void {
    const settings = cairn.settings();
    const mail = NoticeMail.of(settings);
    const password = settings.get('password') ?? '';
    const port = Number(settings.get('port') || 465);
    const host = (settings.get('host') ?? '').trim() || 'smtp.gmail.com';
    const smtp =
      mail && password && Number.isInteger(port) && port > 0 && port < 65536
        ? new SmtpGateway(host, port, mail.from, password)
        : null;
    cairn.onEvent(NoticeSentHandler.TOPIC, new NoticeSentHandler(smtp, mail));
    cairn.addAction('test', new TestAction(smtp, mail));
  }
}
