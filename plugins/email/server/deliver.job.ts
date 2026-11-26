import { BaseJob, type OwnCall } from '../../../apps/server/src/plugin-api';
import type { NoticeMail } from './notice-mail';
import type { SmtpGateway } from './smtp.gateway';

type Item = {
  kind: 'confirm' | 'post';
  address: string;
  token: string;
  apps: string[];
  sendId: string | null;
  subscriberId: string | null;
  title: string;
  link: string;
};

// 30초마다: 보낼 메일을 잡고(claimMail) → 한 통씩 SMTP로(트랜잭션 밖) → 결과를 적는다(reportMail).
// 한 차례에 몇 묶음까지만 (메일 회사의 한도와 일꾼의 다른 일을 생각해 천천히). 하루 상한은 claimMail이 지킨다
export class DeliverJob extends BaseJob {
  readonly name = 'deliver';
  private static readonly ROUNDS = 3;

  constructor(
    private readonly smtp: SmtpGateway | null,
    private readonly mail: NoticeMail | null,
  ) {
    super();
  }

  async run(own: OwnCall): Promise<void> {
    if (!this.smtp || !this.mail) return;
    for (let round = 0; round < DeliverJob.ROUNDS; round++) {
      const { items } = (await own('claimMail', {})) as { items: Item[] };
      if (items.length === 0) return;
      const results = [];
      for (const item of items) {
        const error = await this.send(item);
        if (item.kind === 'post' && item.sendId && item.subscriberId)
          results.push({
            sendId: item.sendId,
            subscriberId: item.subscriberId,
            ok: error === null,
            error,
          });
      }
      if (results.length > 0) await own('reportMail', { results });
    }
  }

  /** 한 통. 실패하면 메일 서버의 글 (받는 사람 주소는 싣지 않는다) */
  private async send(item: Item): Promise<string | null> {
    const mail = this.mail as NoticeMail;
    const message =
      item.kind === 'confirm'
        ? mail.confirm(item.address, item.token, item.apps)
        : mail.post(item.address, item.token, item.apps[0] ?? '', item.title, item.link);
    try {
      await (this.smtp as SmtpGateway).send(
        message,
        item.kind === 'post' ? (item.apps[0] ?? 'Moida') : 'Moida',
        new Date(),
      );
      return null;
    } catch (error) {
      // 메일 서버의 글에 든 주소는 지운다 (해지하면 주소가 남지 않게)
      return (error as Error).message.replace(/[^\s<>]+@[^\s<>]+/g, '(주소)').slice(0, 300);
    }
  }
}
