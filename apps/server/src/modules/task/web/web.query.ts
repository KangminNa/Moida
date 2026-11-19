import { Injectable } from '@nestjs/common';
import { Actor, AgentActor, BaseQuery, Database, Forbidden } from '../../platform';
import { SkillQuery } from '../skill/skill.query';
import { TaskQuery } from '../task/task.query';
import type { ReadUrlInput } from './web.input';
import { WebPageView } from './web.view';
import { WebPageGateway } from './web-page.gateway';
import { WebReach } from './web-reach.policy';

// 주소 읽기 (MCP read_url, 작업 토큰). 목줄은 WebReach, 내부망 막기와 받기는 WebPageGateway.
// 바깥 호출을 기다리는 동안 트랜잭션을 열지 않는다 (지시를 읽는 쿼리 하나만).
@Injectable()
export class WebQuery extends BaseQuery {
  constructor(
    db: Database,
    private readonly pages: WebPageGateway,
    /** 답에 함께 싣는 알림의 글 (지시문 틀) */
    private readonly skills: SkillQuery,
    /** 관리자가 쓴 지시 (목줄의 기준) */
    private readonly tasks: TaskQuery,
  ) {
    super(db);
  }

  async readUrl(actor: Actor, req: ReadUrlInput): Promise<WebPageView> {
    actor.assertCan(Actor.AGENT);
    if (!(actor instanceof AgentActor) || !actor.spaceId) throw new Forbidden(Actor.AGENT);
    const reach = WebReach.of(actor, await this.tasks.ownerText(actor, actor.taskId));
    const page = await this.pages.read(req.url, (url) => reach.assertAllowed(url));
    const note = (await this.skills.prompts(actor, actor.spaceId)).fill('read-url-note');
    return new WebPageView(page.url, page.title, page.text, page.truncated, page.contentType, note);
  }
}
