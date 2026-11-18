import { Injectable } from '@nestjs/common';
import {
  type Actor,
  BlobStore,
  Conflict,
  Database,
  EntityService,
  Idempotency,
  SettingActor,
  type SettingChangeInput,
  SettingOutcome,
  type Sql,
  type VersionInput,
} from '../../platform';
import { MenuRepository } from '../menu/menu.repository';
import { PageRepository } from '../page/page.repository';
import type { App } from './app';
import type { CreateAppInput, UpdateAppInput, UploadIconInput } from './app.input';
import { AppRepository } from './app.repository';
import { AppEdit } from './app-edit';

// 앱 쓰기 (스토어 1단계, 관리자만: 화면에서 바로, 또는 대화에서 AI가 제안한 것을 승인해서 — AppEdit, 메뉴와 같은 줄).
// 공개 여부는 관리자의 고치기에서만 바뀐다 (대화의 제안에는 없다). 지우기는 글 · 페이지 · 호가 없을 때만, 빈 메뉴는 함께 지운다.
// 앱과 메뉴 · 페이지를 한 번에 바꾸는 이 Service만 메뉴 · 페이지의 Repository를 함께 쓴다 (IssueService와 같은 예외)
@Injectable()
export class AppService extends EntityService<App> {
  private static readonly CREATE = 'create_app';

  constructor(
    db: Database,
    private readonly blobs: BlobStore,
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

  /** 본 version이 지금과 다르면 409. 공개 여부가 바뀌면 그래프 사본에 알린다 (App.edit) */
  async update(actor: Actor, req: UpdateAppInput): Promise<App> {
    actor.assertOwner();
    const spaceId = actor.requireSpace();
    return this.transaction(async (tx) => {
      const edit = new AppEdit(tx, spaceId);
      const app = await edit.update(req, new Date());
      await edit.save();
      return app;
    });
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
