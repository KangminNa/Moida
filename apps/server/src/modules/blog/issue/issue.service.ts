import { Injectable } from '@nestjs/common';
import {
  type Actor,
  EntityService,
  Idempotency,
  type Sql,
  type VersionInput,
} from '../../platform';
import { MenuRepository } from '../menu/menu.repository';
import { PostRepository } from '../post/post.repository';
import { PostPublish } from '../post/post-publish.policy';
import { Issue } from './issue';
import type { CreateIssueInput, IssuePostsInput, UpdateIssueInput } from './issue.input';
import { IssueRepository } from './issue.repository';

// 매거진 호 쓰기 (2차 6단계, 관리자 · 결재한 발행). 호와 그 안의 글은 한 트랜잭션에서 함께 바뀌어야 해서
// 이 Service만 글의 Repository를 쓴다 (객체설계 4장 예외, vault ChangeService와 같은 까닭). 잠그는 순서: 메뉴 → 호 → 글
@Injectable()
export class IssueService extends EntityService<Issue> {
  private static readonly CREATE = 'create_issue';
  private static readonly PUBLISH = 'publish_issue';

  protected store(tx: Sql): IssueRepository {
    return new IssueRepository(tx);
  }

  /** 새 호: 메뉴를 잠가 다음 번호로. 같은 requestId는 처음 만든 호 */
  async create(actor: Actor, req: CreateIssueInput): Promise<Issue> {
    actor.assertOwner();
    const spaceId = actor.requireSpace();
    return this.transaction(async (tx) => {
      const issues = this.store(tx);
      const once = new Idempotency(tx, actor.id ?? spaceId, req.requestId, IssueService.CREATE);
      const before = await once.previous();
      if (before) return issues.load(spaceId, String(before.id));
      const menu = await new MenuRepository(tx).holder(spaceId, req.menuId, true);
      const issue = Issue.open(
        menu,
        await issues.nextNumber(menu.id),
        req.title,
        req.intro,
        new Date(),
      );
      await issues.save(issue);
      await once.remember({ id: issue.id });
      return issue;
    });
  }

  update(actor: Actor, req: UpdateIssueInput): Promise<Issue> {
    return this.changeAsOwner(actor, req, (issue) => issue.edit(req.title, req.intro, new Date()));
  }

  /** 호에 든 글을 이 순서로 (빠진 글은 호에서 나온다). 발행한 호는 422 */
  async setPosts(actor: Actor, req: IssuePostsInput): Promise<Issue> {
    actor.assertOwner();
    const spaceId = actor.requireSpace();
    return this.transaction(async (tx) => {
      const issues = this.store(tx);
      const posts = new PostRepository(tx);
      const issue = await issues.lock(spaceId, req.id);
      issue.assertVersion(req.version);
      issue.assertDraft();
      const now = new Date();
      const appId = (await new MenuRepository(tx).holder(spaceId, issue.menuId)).appId;
      for (const post of await posts.lockInIssue(spaceId, issue.id))
        if (!req.postIds.includes(post.id)) {
          post.joinIssue(null, null, 0, actor, now);
          await posts.save(post);
        }
      for (const [index, id] of req.postIds.entries()) {
        const post = await posts.lock(spaceId, id);
        post.joinIssue(issue.id, appId, index + 1, actor, now);
        await posts.save(post);
      }
      issue.edit(null, null, now);
      await issues.save(issue);
      return issue;
    });
  }

  /** 지운다: 발행 전의 호만. 든 글은 호에서 나와 그대로 남는다 */
  async remove(actor: Actor, req: VersionInput): Promise<void> {
    actor.assertOwner();
    const spaceId = actor.requireSpace();
    await this.transaction(async (tx) => {
      const issues = this.store(tx);
      const posts = new PostRepository(tx);
      const issue = await issues.lock(spaceId, req.id);
      issue.assertVersion(req.version);
      issue.assertDraft();
      const now = new Date();
      for (const post of await posts.lockInIssue(spaceId, issue.id)) {
        post.joinIssue(null, null, 0, actor, now);
        await posts.save(post);
      }
      await issues.remove(issue);
    });
  }

  /** 관리자의 발행: 호와 그 글을 모두 공개한다. 하나라도 못 하면 422 (아무것도 바뀌지 않는다) */
  async publish(actor: Actor, req: VersionInput): Promise<Issue> {
    actor.assertOwner();
    const spaceId = actor.requireSpace();
    return this.transaction(async (tx) => {
      const issues = this.store(tx);
      const posts = new PostRepository(tx);
      const issue = await issues.lock(spaceId, req.id);
      issue.assertVersion(req.version);
      const inside = await posts.lockInIssue(spaceId, issue.id);
      issue.publish(inside, new Date());
      for (const post of inside) await posts.save(post);
      await issues.save(issue);
      return issue;
    });
  }

  /**
   * 결재한 호 발행 (IssuePublishHandler). 같은 결재가 다시 오면 앞 결과를 그대로 다시 낸다.
   * 실패면 아무것도 바꾸지 않고 실패 이벤트만 (작업은 끝나야 한다)
   */
  async publishApproved(actor: Actor, issueId: string, targetVersion: number): Promise<void> {
    const approvalId = PostPublish.approvalOf(actor, Issue.ACTION);
    const spaceId = actor.requireSpace();
    await this.transaction(async (tx) => {
      const issues = this.store(tx);
      const posts = new PostRepository(tx);
      const issue = await issues.lockOrNull(spaceId, issueId);
      const once = new Idempotency(tx, spaceId, approvalId, IssueService.PUBLISH);
      const before = await once.previous();
      if (before) return issues.announce(PostPublish.sameResult(spaceId, before));
      const inside = issue ? await posts.lockInIssue(spaceId, issue.id) : [];
      const result = issue
        ? issue.publishApproved(actor, targetVersion, inside, new Date())
        : Issue.failed(spaceId, issueId, approvalId, Issue.NO_ISSUE);
      if (issue && result.data.outcome === 'done') {
        for (const post of inside) await posts.save(post);
        await issues.save(issue);
      }
      await issues.announce(result);
      await once.remember(result.toJSON());
    });
  }
}
