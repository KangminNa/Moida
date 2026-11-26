import { Injectable } from '@nestjs/common';
import {
  type Actor,
  BaseService,
  Database,
  Lookups,
  SettingActor,
  type SettingChangeInput,
  SettingOutcome,
  type Sql,
  StaleVersion,
} from '../../platform';
import type { TermByKind, TermKind } from '../community.tables';
import { Term } from './term';
import { TermRepository } from './term.repository';
import type { TermPublishInput } from './terms.input';
import type { TermView } from './terms.view';
import { TermsChange } from './terms-change';

// 약관 쓰기 (스토어 3-4): 새 버전을 올린다 (추가만). 관리자가 콘솔에서 바로, 또는 일꾼의 제안(설정 바꾸기 terms)을 승인해서.
// 회원에게 보이는 약속이라 AI가 바로 바꾸지 않는다 (원칙 7). 앱은 공간의 앱이면 된다: 공개 전에 써 둔다
@Injectable()
export class TermsService extends BaseService {
  constructor(
    db: Database,
    private readonly lookups: Lookups,
  ) {
    super(db);
  }

  /** 관리자: 본 버전(version, 처음이면 0) 다음 버전을 올린다 (appId가 null이면 공간의 공통 약관). 그사이 다른 버전이 올라왔으면 409 */
  async publish(actor: Actor, req: TermPublishInput): Promise<TermView> {
    actor.assertOwner();
    const owner = req.appId === null ? { spaceId: actor.requireSpace() } : { appId: req.appId };
    if (req.appId !== null) await this.assertApp(actor, req.appId);
    return this.transaction(async (tx) => {
      const term = await TermsService.publishIn(tx, owner, req.kind, req.body, {
        before: req.version,
        by: 'owner',
        byId: actor.id,
      });
      return term.view();
    });
  }

  /** 일꾼의 제안을 미리 해 본다 (저장하지 않음): 앱 · 본문 길이 */
  async rehearseSetting(actor: Actor, change: SettingChangeInput): Promise<void> {
    SettingActor.spaceOf(actor);
    const proposed = TermsChange.of(change);
    await this.assertApp(actor, proposed.appId);
    Term.publish(
      { appId: proposed.appId },
      proposed.kind,
      0,
      proposed.body,
      'approved',
      null,
      new Date(),
    );
  }

  /** 승인한 제안: 결재마다 한 번, 지금 버전 다음으로. 제안한 뒤 관리자가 고쳤으면(본문이 다르면) 실패로 끝난다 */
  async applySetting(actor: Actor, change: SettingChangeInput): Promise<void> {
    const spaceId = SettingOutcome.spaceOf(actor, change.key);
    const proposed = TermsChange.of(change);
    await this.assertApp(actor, proposed.appId);
    await SettingOutcome.settle(
      (work) => this.transaction(work),
      SettingOutcome.topicOf('community'),
      spaceId,
      change.key,
      async (tx) => {
        // 제안할 때 본 본문 그대로인가: 그사이 관리자가 고쳤으면 덮지 않고 실패로 끝낸다 (원칙 3)
        const now = await new TermRepository(tx).latest({ appId: proposed.appId }, proposed.kind);
        change.assertUnchanged(now ? now.settingValues() : null);
        await TermsService.publishIn(tx, { appId: proposed.appId }, proposed.kind, proposed.body, {
          before: now?.version ?? 0,
          by: 'approved',
          byId: actor.id,
        });
      },
    );
  }

  /** 새 버전 한 줄: before(본 버전, 처음이면 0)가 지금 버전이어야 한다 */
  private static async publishIn(
    tx: Sql,
    owner: { appId: string } | { spaceId: string },
    kind: TermKind,
    body: string,
    how: { before: number; by: TermByKind; byId: string | null },
  ): Promise<Term> {
    const terms = new TermRepository(tx);
    const now = (await terms.latest(owner, kind))?.version ?? 0;
    if (how.before !== now) throw new StaleVersion(`약관이 그사이 버전 ${now}로 바뀌었어요`);
    const term = Term.publish(owner, kind, now, body, how.by, how.byId, new Date());
    await terms.save(term);
    return term;
  }

  private assertApp(actor: Actor, appId: string): Promise<void> {
    return this.lookups.assertVisible('app', actor, [appId], '없는 앱이에요');
  }
}
