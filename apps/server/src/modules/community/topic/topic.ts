import { BaseEntity, Conflict, Forbidden, TableEntity } from '../../platform';
import type { TopicNew, TopicRevisionNew, TopicRow, TopicState } from '../community.tables';
import { TopicSavedView } from './topic.view';
import { WriteLimits } from './write-limits.policy';

// 커뮤니티 글 하나 (community.topics + 추가만 하는 topic_revisions, 스토어 3-1b). 회원이 앱 도메인에서 쓴다.
// 제목 · 본문이 바뀔 때마다 버전이 하나 쌓이고(원칙 2), 지워도 내용과 버전은 남는다(쓴 회원의 지우기는 상태 deleted).
// 가림(hidden) · 내림(removed)은 3-1c의 관리 일이다. 쓴 회원만 고치고 지운다
export class Topic extends TableEntity<TopicRow, TopicNew> {
  static readonly TITLE_MAX = 100;
  static readonly BODY_MAX = 20_000;
  static readonly SHOWN: TopicState = 'shown';
  static readonly DELETED: TopicState = 'deleted';

  private added: TopicRevisionNew | null = null;

  /** 새 글: 제목 · 본문 규칙(길이 · 링크 수)은 여기서, 한도 · 같은 본문은 Service가 센 수로 (WriteLimits) */
  static open(
    appId: string,
    memberId: string,
    requestId: string,
    title: string,
    body: string,
    now: Date,
  ): Topic {
    const clean = Topic.checked(title, body);
    const topic = new Topic(
      {
        id: BaseEntity.newId(),
        app_id: appId,
        member_id: memberId,
        title: clean,
        body,
        body_key: WriteLimits.bodyKey(body),
        request_id: requestId,
        created_at: now,
      },
      true,
    );
    topic.added = topic.revisionRow(1, now);
    return topic;
  }

  static restore(row: TopicRow): Topic {
    return new Topic(row);
  }

  get memberId(): string {
    return this.row.member_id;
  }

  get bodyKey(): string {
    return this.row.body_key;
  }

  /** 이번 저장에서 넣을 버전 (만들 때 · 제목이나 본문이 바뀔 때) */
  get addedRevision(): TopicRevisionNew | null {
    return this.added;
  }

  /** 쓴 회원만 (아니면 403) */
  assertAuthor(memberId: string): void {
    if (this.row.member_id !== memberId)
      throw new Forbidden('member', '내가 쓴 글만 고칠 수 있어요');
  }

  /** 고치기: 보이는 글만. 제목 · 본문이 같으면 아무것도 바꾸지 않는다 (버전도 그대로) */
  edit(title: string, body: string, now: Date): void {
    if (this.row.state !== Topic.SHOWN) throw new Conflict('가려지거나 지운 글은 고칠 수 없어요');
    const clean = Topic.checked(title, body);
    if (clean === this.row.title && body === this.row.body) return;
    const seq = this.row.revisions + 1;
    this.put('title', clean);
    this.put('body', body);
    this.put('body_key', WriteLimits.bodyKey(body));
    this.put('revisions', seq);
    this.put('edited_at', now);
    this.added = this.revisionRow(seq, now);
  }

  /** 쓴 회원이 지운다: 보이거나 가려진 글만. 내용 · 버전은 남는다 */
  deleteByAuthor(): void {
    if (this.row.state !== Topic.SHOWN && this.row.state !== 'hidden')
      throw new Conflict('이미 지웠거나 관리자가 내린 글이에요');
    this.put('state', Topic.DELETED);
  }

  savedView(): TopicSavedView {
    return new TopicSavedView(this.row);
  }

  /** 제목은 앞뒤 공백을 빼서 두고, 본문은 그대로 둔다 */
  private static checked(title: string, body: string): string {
    const clean = title.trim();
    WriteLimits.assertText(clean, '제목', Topic.TITLE_MAX);
    WriteLimits.assertText(body, '본문', Topic.BODY_MAX, WriteLimits.TOPIC_LINKS);
    return clean;
  }

  private revisionRow(seq: number, now: Date): TopicRevisionNew {
    const r = this.row;
    return {
      id: BaseEntity.newId(),
      topic_id: this.id,
      seq,
      title: r.title,
      body: r.body,
      created_at: now,
    };
  }
}
