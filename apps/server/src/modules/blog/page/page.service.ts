import { Injectable } from '@nestjs/common';
import { type Actor, EntityService, type Sql } from '../../platform';
import { Page } from './page';
import type { EditPageInput, PageBuiltInput, SwitchPageInput } from './page.input';
import { PageRepository } from './page.repository';
import { PageFiles } from './page-files';

// 페이지 쓰기: 만들기 작업이 끝나며 알린 파일 묶음을 판으로 쌓고(일꾼), 주인이 제목 · 공개 범위 · 보이는 판을 바꾼다.
// AI는 판을 만들 뿐이다: 방문자에게 보이게 하는 것과 보이는 판을 옮기는 것은 주인만 (원칙 7).
@Injectable()
export class PageService extends EntityService<Page> {
  protected store(tx: Sql): PageRepository {
    return new PageRepository(tx);
  }

  /**
   * 만들기 작업이 끝났다 (task.page.built, 일꾼이 부른다). 고칠 페이지가 있으면 앞 판에 얹은 새 판을, 없으면 새 페이지를 만든다.
   * 비공개면 그 판이 바로 보이고 공개면 확인을 기다린다 (Page.publish). 같은 이벤트를 두 번 받아도 판은 하나다 (실행마다 하나)
   */
  async built(actor: Actor, spaceId: string, req: PageBuiltInput): Promise<void> {
    actor.assertOwnerOrSystem();
    const now = new Date();
    await this.transaction(async (tx) => {
      const pages = this.store(tx);
      await pages.lockSpace(spaceId);
      if (await pages.hasRun(spaceId, req.runId)) return;
      const found = req.pageId === null ? null : await pages.lockOrNull(spaceId, req.pageId);
      // 고칠 페이지가 없는데(다른 공간 · 잘못된 id) 바꾼 파일만 왔다: 문이 없는 새 페이지는 만들지 않는다
      if (found === null && !PageFiles.of(req.files).find(PageFiles.ENTRY)) return;
      const page =
        found ??
        Page.open(spaceId, await pages.freeName(spaceId, Page.nameOf(req.title)), req.title, now);
      // 있는 페이지의 새 판: 앞 판의 파일 위에 이번에 만든 파일을 얹는다 (바꾸지 않은 그림 · data.json은 그대로)
      const base = found === null ? null : await pages.filesOf(found.id, found.latestSeq);
      page.publish(
        PageFiles.of(base ? base.overlay(req.files) : req.files),
        req.taskId,
        req.runId,
        req.note,
        now,
      );
      await pages.save(page);
    });
  }

  /** 제목 · 공개 범위 · 방향 */
  edit(actor: Actor, req: EditPageInput): Promise<Page> {
    return this.changeAsOwner(actor, req, (page) =>
      page.edit(req.title, req.visibility, req.direction, new Date()),
    );
  }

  /** 보이는 판을 옮긴다 (되돌리기) */
  switchTo(actor: Actor, req: SwitchPageInput): Promise<Page> {
    return this.changeAsOwner(actor, req, (page) => page.switchTo(req.seq, new Date()));
  }
}
