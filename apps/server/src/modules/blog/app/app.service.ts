import { Injectable } from '@nestjs/common';
import {
  type Actor,
  ApprovedActor,
  BlobStore,
  Conflict,
  Database,
  EntityService,
  Forbidden,
  HostGate,
  Idempotency,
  Lookups,
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
import { PostRepository } from '../post/post.repository';
import { App } from './app';
import type {
  CheckDomainInput,
  CreateAppInput,
  HomeAppInput,
  RemoveAppInput,
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
    private readonly lookups: Lookups,
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
    const app = await this.transaction(async (tx) => {
      const once = new Idempotency(tx, actor.id ?? spaceId, req.requestId, AppService.CREATE);
      const before = await once.previous();
      if (before) return this.store(tx).load(spaceId, String(before.id));
      const edit = new AppEdit(tx, spaceId, this.gate.appsHost() !== null);
      const app = await edit.create(req, new Date());
      await edit.save();
      await once.remember({ id: app.id });
      return app;
    });
    // 공통 앱 도메인은 앱 주소로 앱을 고른다 (2026-11-27): 새 앱 · 바뀐 주소를 바로 다시 읽게
    this.gate.stale();
    return app;
  }

  /** 본 version이 지금과 다르면 409. 공개 여부가 바뀌면 그래프 사본에 알린다 (App.edit). 다른 앱의 도메인이면 409 */
  async update(actor: Actor, req: UpdateAppInput): Promise<App> {
    actor.assertOwner();
    const spaceId = actor.requireSpace();
    const siteHost = req.domain === undefined ? null : await this.gate.siteHost();
    const app = await this.transaction(async (tx) => {
      const edit = new AppEdit(tx, spaceId, this.gate.appsHost() !== null);
      const app = await edit.update(req, new Date(), siteHost);
      await edit.save();
      return app;
    });
    if (req.domain !== undefined || req.changes.slug !== undefined) this.gate.stale();
    return app;
  }

  /** 도메인 연결 확인 (스토어 3-0): 관리자의 브라우저가 앱 도메인에서 읽어 온 값이 맞으면 확인한 때를 적는다. 틀리면 422 */
  checkDomain(actor: Actor, req: CheckDomainInput): Promise<App> {
    const proof = new AppDomainProof(this.box);
    return this.changeAsOwner(actor, req, (app) => app.confirmDomain(proof, req.token, new Date()));
  }

  /**
   * 관리자가 대화에서 요청한 배포 (2026-11-24, 원칙 7의 예외): task가 관리자의 말을 확인하고 바로 승인한 결재 blog.app.publish가 온다.
   * 범위가 ship이면 비공개 앱을 공개로 바꾼다. 없는 앱 · 이미 공개면 그대로 (두 번 받아도 같다). 빠진 점은 task가 먼저 짚었다
   */
  async publishApproved(actor: Actor, appId: string, ship: boolean): Promise<void> {
    if (!(actor instanceof ApprovedActor) || actor.action !== App.PUBLISH_ACTION)
      throw new Forbidden('approved', '승인한 공개만 할 수 있어요');
    if (!ship) return;
    const spaceId = actor.requireSpace();
    const opened = await this.transaction(async (tx) => {
      const apps = this.store(tx);
      const app = await apps.lockOrNull(spaceId, appId);
      if (app === null || !app.publishAsked(new Date(), this.gate.appsHost() !== null))
        return false;
      await apps.save(app);
      return true;
    });
    // 공개 앱의 도메인 목록이 바뀐다 (앱 도메인으로 여는 화면)
    if (opened) this.gate.stale();
  }

  /** 설정 바꾸기 제안의 미리 해 보기: 같은 줄(AppEdit)을 지나고 저장하지 않는다 */
  async rehearseSetting(actor: Actor, change: SettingChangeInput): Promise<void> {
    const spaceId = SettingActor.spaceOf(actor);
    await this.transaction(async (tx) => {
      await new AppEdit(tx, spaceId, this.gate.appsHost() !== null).apply(change, new Date());
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
        const edit = new AppEdit(tx, spaceId, this.gate.appsHost() !== null);
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

  /**
   * 지운다. 페이지 앱의 페이지는 앱 밖으로 풀고, 휴지통의 글은 앱에서 빼 휴지통에 그대로 둔다.
   * 글 · 페이지 · 호가 남아 있으면 409 (먼저 옮기거나 지운다). 회원이 있으면 409.
   * 앱 데이터의 줄이 남아 있으면 withData일 때만 지운다 (표는 community가 blog.app.changed deleted를 받아 치운다)
   */
  async remove(actor: Actor, req: RemoveAppInput): Promise<void> {
    actor.assertOwner();
    const spaceId = actor.requireSpace();
    // 회원이 남은 앱은 지우지 않는다 (2026-11-23, 커뮤니티 앱과 같다): 앱 id로만 이어진 회원이 주인 없이 남는다.
    // 앱 데이터는 관리자가 내보내기를 받고 함께 지우기로 하면 지운다 (2026-11-27, 사용자 "삭제를 누르면 데이터도 내보내지고 삭제할 수 있도록").
    // community에 묻는다 (트랜잭션 밖이라 묻고 지우는 사이에 가입한 회원 · 넣은 줄은 막지 못한다)
    const members = (await this.lookups.visible('app-members', actor, [req.id])).get(req.id);
    const rows = req.withData
      ? undefined
      : (await this.lookups.visible('app-rows', actor, [req.id])).get(req.id);
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
      // 휴지통의 글은 앱에서 빼 둔다 (휴지통에는 그대로): 옮길 수 없는 글이 지우기를 막지 않게
      const posts = new PostRepository(tx);
      for (const post of await posts.lockTrashedIn(spaceId, { appId: app.id })) {
        post.unplaceTrashed(true, actor, new Date());
        await posts.save(post);
      }
      const left = await apps.contents(app.id);
      if (left.posts + left.pages + left.issues > 0)
        throw new Conflict(
          `앱에 글 ${left.posts}개 · 페이지 ${left.pages}개 · 호 ${left.issues}개가 있어 지우지 못해요. 다른 앱으로 옮기거나 지운 뒤 지워요`,
        );
      app.remove();
      // 커뮤니티 앱은 위의 remove가 먼저 막는다 (그쪽 문구가 맞다). 여기서 던지면 위의 옮기기도 모두 되돌아간다
      if (members)
        throw new Conflict(`앱에 ${members}이 남아 있어 지우지 못해요. 비공개로 바꿔 주세요`);
      if (rows)
        throw new Conflict(`앱에 ${rows}이 남아 있어요. 내보낸 뒤 데이터와 함께 삭제해 주세요`);
      await new MenuRepository(tx).removeAllIn(app.id);
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
