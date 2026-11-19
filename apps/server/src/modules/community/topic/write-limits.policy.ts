import { createHash } from 'node:crypto';
import { Conflict, RuleViolation, TooManyRequests } from '../../platform';

// 회원 글 · 댓글의 쓰기 규칙 (스토어 3-1b, 11.0 스팸 · 11.5). 판단만 하고, 수는 Service가 쓰기 트랜잭션에서
// 회원 행을 잠근 뒤 DB에서 세어 넘긴다 (재시작에도 그대로, 같은 회원이 동시에 써도 한도를 넘지 못한다).
// 가입 직후 대기와 차단은 Member.assertCanWrite. 값은 1차에 상수 (바꿀 일이 생기면 그때 설정으로)
// biome-ignore lint/complexity/noStaticOnlyClass: 상태 없는 판단 한 곳
export class WriteLimits {
  static readonly TOPICS_PER_HOUR = 5;
  static readonly TOPICS_PER_DAY = 20;
  static readonly COMMENTS_PER_HOUR = 30;
  /** 링크 수: 글 · 댓글 하나에 */
  static readonly TOPIC_LINKS = 5;
  static readonly COMMENT_LINKS = 2;
  static readonly HOUR_MS = 60 * 60_000;
  static readonly DAY_MS = 24 * WriteLimits.HOUR_MS;
  /** 같은 본문을 다시 올리지 못하는 기간 */
  static readonly SAME_BODY_MS = WriteLimits.DAY_MS;
  private static readonly LINK = /https?:\/\/|www\./gi;

  /** 같은 본문인지 보는 열쇠: 앞뒤 · 겹친 공백과 대소문자를 무시한 본문의 sha256 */
  static bodyKey(body: string): string {
    const normal = body.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();
    return createHash('sha256').update(normal).digest('hex');
  }

  /** 글자 칸 하나: 공백만 있으면 비었다고 보고, 길이와 링크 수를 본다 */
  static assertText(text: string, label: string, max: number, links: number | null = null): void {
    if (text.trim() === '') throw new RuleViolation(`${label}을(를) 써 주세요`);
    if ([...text].length > max) throw new RuleViolation(`${label}은(는) ${max}자까지예요`);
    if (links !== null && (text.match(WriteLimits.LINK)?.length ?? 0) > links)
      throw new RuleViolation(`링크는 ${links}개까지 넣을 수 있어요`);
  }

  /** 글 한도: 최근 1시간 · 하루 동안 쓴 수 */
  static assertTopicPace(lastHour: number, lastDay: number): void {
    if (lastHour >= WriteLimits.TOPICS_PER_HOUR)
      throw new TooManyRequests(`한 시간에 글은 ${WriteLimits.TOPICS_PER_HOUR}개까지예요`);
    if (lastDay >= WriteLimits.TOPICS_PER_DAY)
      throw new TooManyRequests(`하루에 글은 ${WriteLimits.TOPICS_PER_DAY}개까지예요`);
  }

  static assertCommentPace(lastHour: number): void {
    if (lastHour >= WriteLimits.COMMENTS_PER_HOUR)
      throw new TooManyRequests(`한 시간에 댓글은 ${WriteLimits.COMMENTS_PER_HOUR}개까지예요`);
  }

  /** 같은 본문을 SAME_BODY_MS 안에 다시 올리면 409 (도배 막기) */
  static assertFresh(repeated: boolean): void {
    if (repeated) throw new Conflict('같은 내용을 방금 올렸어요');
  }
}
