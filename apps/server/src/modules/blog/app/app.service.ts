import { Injectable } from '@nestjs/common';
import {
  type Actor,
  BlobStore,
  Conflict,
  Database,
  EntityService,
  HostGate,
  Idempotency,
  NotFound,
  SecretBox,
  SettingActor,
  type SettingChangeInput,
  SettingOutcome,
  type Sql,
  type VersionInput,
} from '../../platform';
import { MenuRepository } from '../menu/menu.repository';
import { PageRepository } from '../page/page.repository';
import type { App } from './app';
import type {
  CheckDomainInput,
  CreateAppInput,
  HomeAppInput,
  UpdateAppInput,
  UploadIconInput,
} from './app.input';
import { AppRepository } from './app.repository';
import { AppDomainProof } from './app-domain.policy';
import { AppEdit } from './app-edit';

// 앱 쓰기 (스토어 1단계, 관리자만: 화면에서 바로, 또는 대화에서 AI가 제안한 것을 승인해서 — AppEdit, 메뉴와 같은 줄).
// 공개 여부는 관리자의 고치기에서만 바뀐다 (대화의 제안에는 없다). 지우기는 글 · 페이지 · 호가 없을 때만, 빈 메뉴는 함께 지운다.
// 앱과 메뉴 · 페이지를 한 번에 바꾸는 이 Service만 메뉴 · 페이지의 Repository를 함께 쓴다 (IssueService와 같은 예외).
// 도메인(스토어 3-0)은 관리자의 고치기에서만 바뀐다. 기본 도메인은 트랜잭션 전에 platform HostGate에 묻고,
// 도메인이 바뀌거나 앱을 지우면 HostGate가 앱 도메인 목록을 다시 읽게 한다
@Injectable()
export class AppService extends EntityService<App> {
  private static readonly CREATE = 'create_app';

  constructor(
    db: Database,
    private readonly blobs: BlobStore,
    private readonly gate: HostGate,
    private readonly box: SecretBox,
  ) {
    super(db);
  }

  protected store(tx: Sql): AppRepository {
    return new AppRepository(tx);
  }

  /** 같은 requestId가 다시 오면 처음 만든 앱을 돌려준다 */
  async create(actor: Actor, req: CreateAppInput): Promise<App> {
    actor.assertOwner();
    const spaceId = actor.requireSpace();
    return this.transaction(async (tx) => {
      const once = new Idempotency(tx, actor.id ?? spaceId, req.requestId, AppService.CREATE);
      const before = await once.previous();
      if (before) return this.store(tx).load(spaceId, String(before.id));
      const edit = new AppEdit(tx, spaceId);
      const app = await edit.create(req, new Date());
      await edit.save();
      await once.remember({ id: app.id });
      return app;
    });
  }

  /** 본 version이 지금과 다르면 409. 공개 여부가 바뀌면 그래프 사본에 알린다 (App.edit). 다른 앱의 도메인이면 409 */
  async update(actor: Actor, req: UpdateAppInput): Promise<App> {
    actor.assertOwner();
    const spaceId = actor.requireSpace();
    const siteHost = req.domain === undefined ? null : await this.gate.siteHost();
    const app = await this.transaction(async (tx) => {
      const edit = new AppEdit(tx, spaceId);
      const app = await edit.update(req, new Date(), siteHost);
      await edit.save();
      return app;
    });
    if (req.domain !== undefined) this.gate.stale();
    return app;
  }

  /** 도메인 연결 확인 (스토어 3-0): 관리자의 브라우저가 앱 도메인에서 읽어 온 값이 맞으면 확인한 때를 적는다. 틀리면 422 */
  checkDomain(actor: Actor, req: CheckDomainInput): Promise<App> {
    const proof = new AppDomainProof(this.box);
    return this.changeAsOwner(actor, req, (app) => app.confirmDomain(proof, req.token, new Date()));
  }

  /** 설정 바꾸기 제안의 미리 해 보기: 같은 줄(AppEdit)을 지나고 저장하지 않는다 */
  async rehearseSetting(actor: Actor, change: SettingChangeInput): Promise<void> {
    const spaceId = SettingActor.spaceOf(actor);
    await this.transaction(async (tx) => {
      await new AppEdit(tx, spaceId).apply(change, new Date());
    });
  }

  /** 승인한 설정 바꾸기: 결재마다 한 번 적용하고 결과(blog.setting.changed)를 남긴다. 승인한 뒤 바뀌었으면 실패 */
  async applySetting(actor: Actor, change: SettingChangeInput): Promise<void> {
    const spaceId = SettingOutcome.spaceOf(actor, change.key);
    await SettingOutcome.settle(
      (work) => this.transaction(work),
      SettingOutcome.topicOf('blog'),
      spaceId,
      change.key,
      async (tx) => {
        const edit = new AppEdit(tx, spaceId);
        await edit.apply(change, new Date());
        await edit.save();
      },
    );
  }

  /**
   * 방문자 첫 화면(/)으로 고정할 앱 (스토어 2단계). 공간의 앱을 모두 잠그고(둘이 동시에 고정해도 하나만 남게)
   * 다른 앱의 고정을 푼 뒤 이 앱을 고정한다. null은 모두 풀기 (자동). 비공개 앱이면 422. 같은 값이면 그대로
   */
  async pinHome(actor: Actor, req: HomeAppInput): Promise<void> {
    actor.assertOwner();
    const spaceId = actor.requireSpace();
    await this.transaction(async (tx) => {
      const apps = this.store(tx);
      const all = await apps.lockAll(spaceId);
      if (req.appId !== null && !all.some((app) => app.id === req.appId))
        throw new NotFound('앱을 찾을 수 없어요');
      const now = new Date();
      // 푸는 것을 먼저 저장한다: 고정은 공간마다 하나(apps_one_home)라 거는 쪽이 먼저면 겹친다
      for (const app of all) app.pinHome(app.id === req.appId, now);
      const pinned = all.filter((app) => app.id === req.appId);
      for (const app of [...all.filter((app) => app.id !== req.appId), ...pinned])
        await apps.save(app);
    });
  }

  /** 지운다. 페이지 앱의 페이지는 앱 밖으로 풀고, 글 · 페이지 · 호가 남아 있으면 409 (먼저 옮기거나 지운다) */
  async remove(actor: Actor, req: VersionInput): Promise<void> {
    actor.assertOwner();
    const spaceId = actor.requireSpace();
    await this.transaction(async (tx) => {
      const apps = this.store(tx);
      const app = await apps.lock(spaceId, req.id);
      app.assertVersion(req.version);
      const pages = new PageRepository(tx);
      if (app.kind === 'page')
        for (const page of await pages.lockInApp(spaceId, app.id)) {
          page.moveToApp(null, new Date());
          await pages.save(page);
        }
      const left = await apps.contents(app.id);
      if (left.posts + left.pages + left.issues > 0)
        throw new Conflict(
          `앱에 글 ${left.posts}개 · 페이지 ${left.pages}개 · 호 ${left.issues}개가 있어 지우지 못해요`,
        );
      await new MenuRepository(tx).removeAllIn(app.id);
      app.remove();
      await apps.remove(app);
    });
    this.gate.stale();
  }

  /**
   * 아이콘 올리기. 파일은 트랜잭션 밖에서 쓰고(같은 내용이면 있던 파일), 앱에는 해시만 남긴다.
   * 판이 낡아 저장하지 못하면 파일만 남고, 아무도 쓰지 않으니 platform의 청소가 지운다
   */
  async uploadIcon(actor: Actor, req: UploadIconInput): Promise<App> {
    actor.assertOwner();
    const blob = await this.blobs.save(req.bytes, req.mime);
    return this.changeAsOwner(actor, req, (app) => app.setIcon(blob.hash, new Date()));
  }

  removeIcon(actor: Actor, req: VersionInput): Promise<App> {
    return this.changeAsOwner(actor, req, (app) => app.setIcon(null, new Date()));
  }
}
