import { type Row, TableRepository } from '../../platform';
import { topicRevisions, topics } from '../community.schema';
import type { TopicRow } from '../community.tables';
import { Topic } from './topic';

// community.topics ↔ Topic (+ 버전 topic_revisions). load · lock의 첫 값은 앱 id다 (글은 앱에 든다).
// 쓰기 한도는 쓴 회원의 행을 잠근 트랜잭션 안에서 센다 (paceOf · repeated)
export class TopicRepository extends TableRepository<TopicRow, Topic> {
  protected readonly table = topics;
  protected readonly noun = '글';

  protected toEntity(row: TopicRow): Topic {
    return Topic.restore(row);
  }

  protected override select(appId: string, id: string, lock: boolean): Promise<readonly Row[]> {
    return this.rows(topics, { id, app_id: appId }, { lock });
  }

  protected override async saveParts(topic: Topic): Promise<void> {
    if (topic.addedRevision) await this.insertRows(topicRevisions, topic.addedRevision);
  }

  /** 같은 회원 · 같은 requestId로 이미 만든 글 (응답을 못 받아 다시 보낸 요청) */
  findByRequest(memberId: string, requestId: string): Promise<Topic | null> {
    return this.findOne({ member_id: memberId, request_id: requestId });
  }

  /** 이 회원이 최근 1시간 · 하루 동안 쓴 글 수 (지운 글도 센다: 지우고 다시 쓰기로 한도를 피하지 못하게) */
  async paceOf(memberId: string, hourAgo: Date, dayAgo: Date): Promise<readonly [number, number]> {
    const [row] = await this.sql<{ hour: string; day: string }[]>`
      SELECT count(*) FILTER (WHERE created_at > ${hourAgo}) AS hour, count(*) AS day
      FROM community.topics WHERE member_id = ${memberId} AND created_at > ${dayAgo}`;
    return [Number(row?.hour ?? 0), Number(row?.day ?? 0)];
  }

  /** 이 회원이 since 뒤에 같은 본문(열쇠)의 글을 올렸는가 */
  repeated(memberId: string, bodyKey: string, since: Date): Promise<boolean> {
    return this.sql<{ one: number }[]>`
      SELECT 1 AS one FROM community.topics
      WHERE member_id = ${memberId} AND body_key = ${bodyKey} AND created_at > ${since} LIMIT 1`.then(
      (rows) => rows.length > 0,
    );
  }
}
