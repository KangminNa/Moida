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

// 메일 (2026-11-26, 기획서 결정, docs/이메일.md). 메일 서버를 직접 띄우지 않고 메일 회사의 SMTP(465, TLS)로 보낸다.
//   관리자 알림: 코어의 알림이 푸시로 보내기로 정한 것(platform.notice.sent)을 한 통씩
//   자동화 결과: "메일로 받기"를 켠 레시피의 회차 답 · 실패(task.chat.said의 mail)를 관리자에게 (2026-11-27)
//   가입자 소식 메일: 가입 때 동의한 계정에게, 대표가 쓰고 관리자가 승인한 메일 (news.ts, 2026-11-27)
//   앱 소식 구독: 방문자가 스토어 첫 화면(store.after)에서 신청 → 확인 메일 → 확인. 글이 공개되면 소식이 생기고
//     관리자가 콘솔(운영 › 메일 구독)에서 보내기를 누르면 일꾼(deliver, 30초마다)이 하루 상한 안에서 보낸다
//   확인 메일: 코어의 가입 · 비밀번호 다시 정하기 인증코드 (provideMail, 0.14)
export default class EmailPlugin extends BasePlugin {
  static readonly DAILY_MAX = 300;

  register(cairn: PluginContext): void {
    const settings = cairn.settings();
    const mail = NoticeMail.of(settings);
    const password = settings.get('password') ?? '';
    const port = Number(settings.get('port') || 465);
    const host = SmtpGateway.hostOf(settings.get('host') ?? '');
    const smtp =
      mail && password && Number.isInteger(port) && port > 0 && port < 65536
        ? new SmtpGateway(host, port, mail.from, password)
        : null;
    const daily = Number.parseInt(settings.get('dailyMax') ?? '', 10);
    const dailyMax = Number.isInteger(daily) && daily > 0 ? daily : EmailPlugin.DAILY_MAX;
    // 구독 칸은 관리자가 켜야 보이고, 메일을 보낼 수 있어야 받는다
    const open = settings.get('subscriptions') === 'true' && smtp !== null;
    cairn.onEvent(NoticeSentHandler.TOPIC, new NoticeSentHandler(smtp, mail));
    cairn.onEvent(ChatSaidHandler.TOPIC, new ChatSaidHandler(smtp, mail));
    cairn.onEvent('blog.post.published', new PostPublished(mail?.site ?? null));
    cairn.addOperation(new Subscribe(open));
    cairn.addOperation(new Confirm());
    cairn.addOperation(new Unsubscribe());
    cairn.addOperation(new Overview(smtp !== null, open, dailyMax));
    cairn.addOperation(new RemoveSubscriber());
    cairn.addOperation(new StartSend());
    cairn.addOperation(new CancelSend());
    cairn.addOperation(new ClaimMail(dailyMax));
    cairn.addOperation(new ReportMail());
    cairn.every('30s', new DeliverJob(smtp, mail));
    // 가입자 소식 메일 (2026-11-27): 동의 맞추기 → 대표의 초안 → 결재 email.news.send → 승인되면 대기열
    cairn.onEvent('community.account.news', new SyncAccountNews());
    cairn.addOperation(new DraftNews());
    cairn.addOperation(new GetNews());
    cairn.onEvent('task.approval.granted', new SendApprovedNews());
    for (const closed of ['rejected', 'revision_requested', 'cancelled'])
      cairn.onEvent(`task.approval.${closed}`, new DropNews());
    cairn.addAction('test', new TestAction(smtp, mail));
    // 코어의 확인 메일 (가입 · 비밀번호 다시 정하기의 인증코드): 보낼 수 있을 때만 길을 연다
    if (smtp && mail) cairn.provideMail(new CodeMailer(smtp, mail.from, dailyMax));
  }
}
