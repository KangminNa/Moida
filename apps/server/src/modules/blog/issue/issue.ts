import { type Actor, BaseEntity, DomainEvent, RuleViolation, TableEntity } from '../../platform';
import type { IssueNew, IssueRow } from '../blog.tables';
import type { Menu } from '../menu/menu';
import type { Post } from '../post/post';
import { PostPublish } from '../post/post-publish.policy';
import { IssueView } from './issue.view';

// 매거진 호 하나 (blog.issues, 2차 6단계). "호 목록" 메뉴 안에 번호로 있고, 글은 issue_id · issue_order로 들어온다.
// 발행은 호 전체를 한 번에: 결재 동작 하나(blog.issue.publish) 또는 관리자의 발행. 호와 그 안의 글이 한 트랜잭션에서
// 모두 공개되고, 하나라도 공개할 수 없으면(휴지통 글 · 글 없음 · 결재 뒤 바뀜) 아무것도 바꾸지 않는다.
// 결재한 발행의 결과는 기록하지 않고 돌려준다 (같은 결재가 다시 오면 IssueService가 앞 결과를 그대로 낸다, 글과 같다)
export class Issue extends TableEntity<IssueRow, IssueNew> {
  static readonly DRAFT = 'draft';
  static readonly PUBLISHED = 'published';
  /** 결재로 맡기는 호 발행 (task.approvals.action) */
  static readonly ACTION = 'blog.issue.publish';
  static readonly TITLE_MAX = 120;
  static readonly INTRO_MAX = 2000;
  /** 호 하나에 넣는 글 */
  static readonly POSTS_MAX = 50;
  static readonly NO_ISSUE = '없는 호라 발행하지 않았어요';
  private static readonly PUBLISHED_EVENT = 'blog.issue.published';
  private static readonly FAILED = 'blog.issue.publish_failed';

  /** 새 호: 메뉴의 다음 번호로 (번호는 Service가 메뉴를 잠그고 정한다) */
  static open(menu: Menu, number: number, title: string, intro: string | null, now: Date): Issue {
    menu.assertHolds('issue');
    const issue = new Issue(
      {
        id: BaseEntity.newId(),
        space_id: menu.spaceId,
        menu_id: menu.id,
        number,
        title: '',
        created_at: now,
        updated_at: now,
      },
      true,
    );
    issue.edit(title, intro, now);
    return issue;
  }

  static restore(row: IssueRow): Issue {
    return new Issue(row);
  }

  get menuId(): string {
    return this.row.menu_id;
  }

  /** 제목 · 소개. null은 그대로, 소개 ""은 지우기 */
  edit(title: string | null, intro: string | null, now: Date): void {
    if (title !== null) {
      const clean = title.trim();
      if (clean.length < 1 || clean.length > Issue.TITLE_MAX)
        throw new RuleViolation(`호 제목은 1~${Issue.TITLE_MAX}자예요`);
      this.put('title', clean);
    }
    if (intro !== null) {
      if (intro.length > Issue.INTRO_MAX)
        throw new RuleViolation(`소개는 ${Issue.INTRO_MAX}자까지예요`);
      this.put('intro', intro.trim() || null);
    }
    this.put('updated_at', now);
  }

  /** 글을 넣고 빼는 것은 발행 전에만 (발행한 호는 그대로 남는다) */
  assertDraft(): void {
    if (this.row.status === Issue.PUBLISHED) throw new RuleViolation('이미 발행한 호예요');
  }

  /** 관리자의 발행: 공개할 수 없으면 그 까닭으로 422 */
  publish(posts: readonly Post[], now: Date): void {
    const problem = this.problemOf(posts, null) ?? this.publishPosts(posts, now);
    if (problem) throw new RuleViolation(problem);
    this.markPublished(now);
    this.record(this.event(Issue.PUBLISHED_EVENT, {}));
  }

  /** 결재한 발행: 결재한 그대로일 때만. 결과(성공 · 실패) 이벤트를 돌려준다 */
  publishApproved(
    by: Actor,
    targetVersion: number,
    posts: readonly Post[],
    now: Date,
  ): DomainEvent {
    const approvalId = PostPublish.approvalOf(by, Issue.ACTION);
    const problem = this.problemOf(posts, targetVersion) ?? this.publishPosts(posts, now);
    if (problem) return Issue.failed(this.row.space_id, this.id, approvalId, problem);
    this.markPublished(now);
    return this.event(Issue.PUBLISHED_EVENT, { approvalId, outcome: 'done' });
  }

  /** 결재한 발행의 실패 결과. 호를 찾지 못해도 작업은 끝나야 해서 호 없이 만든다 */
  static failed(spaceId: string, issueId: string, approvalId: string, error: string): DomainEvent {
    return new DomainEvent(Issue.FAILED, 1, spaceId, {
      issueId,
      approvalId,
      outcome: 'failed',
      error,
    });
  }

  view(posts: readonly Post[] = []): IssueView {
    return new IssueView(this.row, posts.length);
  }

  private problemOf(posts: readonly Post[], targetVersion: number | null): string | null {
    if (this.row.status === Issue.PUBLISHED) return '이미 발행한 호예요';
    if (targetVersion !== null && this.version !== targetVersion)
      return `결재를 올린 뒤 바뀐 호라 발행하지 않았어요 (결재 ${targetVersion}, 지금 ${this.version})`;
    if (posts.length === 0) return '글이 없는 호예요';
    return null;
  }

  /** 글을 모두 공개한다. 하나라도 못 하면 그 까닭 (트랜잭션이 되돌리므로 앞 글의 변경도 남지 않는다) */
  private publishPosts(posts: readonly Post[], now: Date): string | null {
    for (const post of posts) {
      const problem = post.publishWithIssue(now);
      if (problem) return problem;
    }
    return null;
  }

  private markPublished(now: Date): void {
    this.put('status', Issue.PUBLISHED);
    this.put('published_at', now);
    this.put('updated_at', now);
  }

  private event(topic: string, more: Readonly<Record<string, unknown>>): DomainEvent {
    return new DomainEvent(topic, 1, this.row.space_id, {
      issueId: this.id,
      menuId: this.row.menu_id,
      number: this.row.number,
      title: this.row.title,
      ...more,
    });
  }
}
