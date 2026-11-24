import { Injectable } from '@nestjs/common';
import { Actor, AgentActor, BaseQuery, Database, Forbidden } from '../../platform';
import { SkillQuery } from '../skill/skill.query';
import type { ReadUrlInput } from './web.input';
import { WebPageView } from './web.view';
import { WebPageGateway } from './web-page.gateway';
import { WebReach } from './web-reach.policy';

// 주소 읽기 (MCP read_url, 작업 토큰). 목줄은 WebReach, 내부망 막기와 받기는 WebPageGateway.
// 바깥 호출을 기다리는 동안 트랜잭션을 열지 않는다.
@Injectable()
export class WebQuery extends BaseQuery {
  /** 이보다 짧은 HTML 본문은 껍데기로 본다 */
  private static readonly SHELL_MAX = 300;
  private static readonly HTML = /^(text\/html|application\/xhtml\+xml)\b/i;
  constructor(
    db: Database,
    private readonly pages: WebPageGateway,
    /** 답에 함께 싣는 알림의 글 (지시문 틀) */
    private readonly skills: SkillQuery,
  ) {
    super(db);
  }

  async readUrl(actor: Actor, req: ReadUrlInput): Promise<WebPageView> {
    actor.assertCan(Actor.AGENT);
    if (!(actor instanceof AgentActor) || !actor.spaceId) throw new Forbidden(Actor.AGENT);
    const page = await this.pages.read(req.url, (url) => WebReach.assertAllowed(url));
    const prompts = await this.skills.prompts(actor, actor.spaceId);
    // 글이 거의 없는 HTML이면 자바스크립트로 그리는 페이지일 수 있다: 서버 브라우저로 읽는 길을 알린다 (browser_read, 2026-11-24)
    const shell =
      WebQuery.HTML.test(page.contentType) && page.text.trim().length < WebQuery.SHELL_MAX;
    const note = [prompts.fill('read-url-note'), shell ? prompts.fill('read-url-shell') : '']
      .filter(Boolean)
      .join('\n');
    return new WebPageView(page.url, page.title, page.text, page.truncated, page.contentType, note);
  }
}
