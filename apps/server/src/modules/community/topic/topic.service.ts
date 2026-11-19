import { Injectable } from '@nestjs/common';
import {
  type Actor,
  BaseService,
  Database,
  Lookups,
  MemberActor,
  type VersionInput,
} from '../../platform';
import type { MemberPlace } from '../member/member.input';
import { MemberRepository } from '../member/member.repository';
import { Topic } from './topic';
import type { TopicEditInput, TopicWriteInput } from './topic.input';
import { TopicRepository } from './topic.repository';
import { WriteLimits } from './write-limits.policy';

// 커뮤니티 글 쓰기 (스토어 3-1b): 쓰기 · 고치기 · 지우기, 회원만 · 쓴 회원만.
// 쓰기는 한 트랜잭션에서 쓴 회원의 행을 먼저 잠그고(MemberRepository.lock: 같은 회원의 쓰기를 줄 세운다, 회원 행은 바꾸지 않는다)
// 차단 · 가입 대기 → 같은 requestId → 한도(시간 · 하루) → 같은 본문 순서로 본다. 잠그는 순서는 회원 → 글
@Injectable()
export class TopicService extends BaseService {
  constructor(
    db: Database,
    private readonly lookups: Lookups,
  ) {
    super(db);
  }

  /** 새 글. 같은 requestId를 다시 보내면 처음 만든 글 */
  async write(actor: Actor, place: MemberPlace, req: TopicWriteInput): Promise<Topic> {
    const me = MemberActor.require(actor, place.appId);
    await this.assertCommunity(actor, place);
    const now = new Date();
    return this.transaction(async (tx) => {
      const member = await new MemberRepository(tx).lock(place.appId, me.id ?? '');
      member.assertCanWrite(now);
      const topics = new TopicRepository(tx);
      const before = await topics.findByRequest(member.id, req.requestId);
      if (before) return before;
      const topic = Topic.open(place.appId, member.id, req.requestId, req.title, req.body, now);
      const [hour, day] = await topics.paceOf(
        member.id,
        new Date(now.getTime() - WriteLimits.HOUR_MS),
        new Date(now.getTime() - WriteLimits.DAY_MS),
      );
      WriteLimits.assertTopicPace(hour, day);
      const since = new Date(now.getTime() - WriteLimits.SAME_BODY_MS);
      WriteLimits.assertFresh(await topics.repeated(member.id, topic.bodyKey, since));
      await topics.save(topic);
      return topic;
    });
  }

  /** 고치기: 쓴 회원만, 보이는 글만, 차단 중이면 403. 제목 · 본문이 바뀌면 새 버전 */
  async edit(actor: Actor, place: MemberPlace, req: TopicEditInput): Promise<Topic> {
    const me = MemberActor.require(actor, place.appId);
    await this.assertCommunity(actor, place);
    const now = new Date();
    return this.transaction(async (tx) => {
      const member = await new MemberRepository(tx).lock(place.appId, me.id ?? '');
      member.assertActive(now);
      const topics = new TopicRepository(tx);
      const topic = await topics.lock(place.appId, req.id);
      topic.assertAuthor(member.id);
      topic.assertVersion(req.version);
      topic.edit(req.title, req.body, now);
      await topics.save(topic);
      return topic;
    });
  }

  /** 쓴 회원이 지운다 (내용 · 버전은 남는다). 차단 중이어도 자기 글은 지울 수 있다 */
  async delete(actor: Actor, place: MemberPlace, req: VersionInput): Promise<void> {
    const me = MemberActor.require(actor, place.appId);
    await this.assertCommunity(actor, place);
    await this.transaction(async (tx) => {
      const topics = new TopicRepository(tx);
      const topic = await topics.lock(place.appId, req.id);
      topic.assertAuthor(me.id ?? '');
      topic.assertVersion(req.version);
      topic.deleteByAuthor();
      await topics.save(topic);
    });
  }

  private assertCommunity(actor: Actor, place: MemberPlace): Promise<void> {
    return this.lookups.assertVisible('community-app', actor, [place.appId], '없는 주소예요');
  }
}
