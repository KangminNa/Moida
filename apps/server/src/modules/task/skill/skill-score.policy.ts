import { TeamRoster } from '../task/team-roster';

// 스킬 버전 성적표 (2026-11-24, GitHub 스킬 프로젝트에서 가져온 "버전마다 성적을 보고 고른다"). 스킬 메뉴가
// 버전(저장소 판의 해시 · 콘솔 판의 번호)마다 최근 TeamRoster.SCORE_DAYS일의 일을 모아 보인다. 일 하나는 처음 실행의
// 버전에 센다 (그 버전이 낸 첫 결과로 판정받으니까). 판정(task.verdicts)은 검토자의 일에 남아 일꾼의 실행과 이어지지 않아
// 쓰지 않고, 일 자체의 기록(끝남 · 관리자의 수정 요청 · 반려 · 토큰)으로 센다. 끝난 일이 적으면 비율이 흔들려 판단을 미룬다.
// biome-ignore lint/complexity/noStaticOnlyClass: 상태 없는 판단 한 곳. SkillQuery · SkillScoreView가 쓴다
export class SkillScore {
  /** 성적표의 기간 (일): 에이전트 성적표와 같다 */
  static readonly DAYS = TeamRoster.SCORE_DAYS;
  /** 이보다 적게 끝난 버전은 "판단 보류" */
  static readonly MIN_FINISHED = 5;

  static since(now: Date): Date {
    return TeamRoster.scoreSince(now);
  }

  static settled(finished: number): boolean {
    return finished >= SkillScore.MIN_FINISHED;
  }

  /** 관리자 결정에서 빼는 동작 (결과 카드 고르기 · 로그인했어요: 품질이 아님). 에이전트 성적표와 같다 */
  static skipped(): string[] {
    return [...TeamRoster.SCORE_SKIP];
  }
}
