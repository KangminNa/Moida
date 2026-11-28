import { BasePlugin, type PluginContext } from '../../../apps/server/src/plugin-api';
import { ChatSaidHandler } from './chat-said.handler';
import { CodeMailer } from './code-mailer';
import { DeliverJob } from './deliver.job';
import { ClaimMail, ReportMail } from './delivery';
import { DraftNews, DropNews, GetNews, SendApprovedNews, SyncAccountNews } from './news';
import { NoticeMail } from './notice-mail';
import { NoticeSentHandler } from './notice-sent.handler';
import { CancelSend, Overview, PostPublished, RemoveSubscriber, StartSend } from './sends';
import { SmtpGateway } from './smtp.gateway';
import { Confirm, Subscribe, Unsubscribe } from './subscriptions';
import { TestAction } from './test.action';
import { MailGate, MailLimits, TakeMail } from './usage';

// 메일 (2026-11-26, 기획서 결정, docs/이메일.md). 메일 서버를 직접 띄우지 않고 메일 회사의 SMTP(465, TLS)로 보낸다.
//   관리자 알림: 코어의 알림이 푸시로 보내기로 정한 것(platform.notice.sent)을 한 통씩
//   자동화 결과: "메일로 받기"를 켠 레시피의 회차 답 · 실패(task.chat.said의 mail)를 관리자에게 (2026-11-27)
//   가입자 소식 메일: 가입 때 동의한 계정에게, 대표가 쓰고 관리자가 승인한 메일 (news.ts, 2026-11-27)
//   앱 소식 구독: 방문자가 스토어 첫 화면(store.after)에서 신청 → 확인 메일 → 확인. 글이 공개되면 소식이 생기고
//     관리자가 콘솔(운영 › 메일 구독)에서 보내기를 누르면 일꾼(deliver, 30초마다)이 하루 상한 안에서 보낸다
//   확인 메일: 코어의 가입 · 비밀번호 다시 정하기 인증코드 (provideMail, 0.14)
//   사용량 (2026-11-27, usage.ts): 모든 메일을 보내기 전에 하루 · 한 달 상한을 보고 센다. 한 통씩 가는 메일은
//     moida.own()으로 takeMail을, 소식 · 확인 메일은 claimMail이 같은 표에서 센다
export default class EmailPlugin extends BasePlugin {
  static readonly DAILY_MAX = 300;

  register(moida: PluginContext): void {
    const settings = moida.settings();
    const mail = NoticeMail.of(settings);
    const password = settings.get('password') ?? '';
    const port = Number(settings.get('port') || 465);
    const host = SmtpGateway.hostOf(settings.get('host') ?? '');
    const smtp =
      mail && password && Number.isInteger(port) && port > 0 && port < 65536
        ? new SmtpGateway(host, port, mail.from, password)
        : null;
    const limits = new MailLimits(
      MailLimits.count(settings.get('dailyMax'), EmailPlugin.DAILY_MAX),
      MailLimits.count(settings.get('monthlyMax'), 0),
    );
    const gate = new MailGate(moida.own());
    // 구독 칸은 관리자가 켜야 보이고, 메일을 보낼 수 있어야 받는다
    const open = settings.get('subscriptions') === 'true' && smtp !== null;
    moida.onEvent(NoticeSentHandler.TOPIC, new NoticeSentHandler(smtp, mail, gate));
    moida.onEvent(ChatSaidHandler.TOPIC, new ChatSaidHandler(smtp, mail, gate));
    moida.onEvent('blog.post.published', new PostPublished(mail?.site ?? null));
    moida.addOperation(new Subscribe(open));
    moida.addOperation(new Confirm());
    moida.addOperation(new Unsubscribe());
    moida.addOperation(new Overview(smtp !== null, open, limits));
    moida.addOperation(new RemoveSubscriber());
    moida.addOperation(new StartSend());
    moida.addOperation(new CancelSend());
    moida.addOperation(new ClaimMail(limits));
    moida.addOperation(new ReportMail());
    moida.addOperation(new TakeMail(limits));
    moida.every('30s', new DeliverJob(smtp, mail));
    // 가입자 소식 메일 (2026-11-27): 동의 맞추기 → 대표의 초안 → 결재 email.news.send → 승인되면 대기열
    moida.onEvent('community.account.news', new SyncAccountNews());
    moida.addOperation(new DraftNews());
    moida.addOperation(new GetNews());
    moida.onEvent('task.approval.granted', new SendApprovedNews());
    for (const closed of ['rejected', 'revision_requested', 'cancelled'])
      moida.onEvent(`task.approval.${closed}`, new DropNews());
    moida.addAction('test', new TestAction(smtp, mail, gate));
    // 코어의 확인 메일 (가입 · 비밀번호 다시 정하기의 인증코드): 보낼 수 있을 때만 길을 연다
    if (smtp && mail) moida.provideMail(new CodeMailer(smtp, mail.from, gate));
  }
}
