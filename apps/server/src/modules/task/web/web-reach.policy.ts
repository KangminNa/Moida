import { RuleViolation } from '../../platform';

// 주소 읽기(read_url)의 목줄 한 곳 (기획서 결정 2026-11-13). 서버가 AI 대신 주소를 열 때 어디까지 열지 정한다.
// 2026-11-21 (사용자 결정 "비공개도 그냥 읽어", 모두 같은 일꾼): 모든 에이전트가 비공개를 읽으므로 "지시에 적힌 사이트만" 목줄은 없앴다.
// 공개 주소 어디든 열고, 남은 것은 모양 검사(http · https, 아이디 · 비밀번호가 든 주소)다.
// 내부망 · 이 서버는 열지 않는다 (WebPageGateway가 주소를 풀어 본다). 주소에 정보를 싣지 말라는 것은 지시문(read-url-note)이 말한다
// biome-ignore lint/complexity/noStaticOnlyClass: 상태 없는 판단 한 곳
export class WebReach {
  /** 열어도 되는 주소인지. 안 되면 AI가 읽을 이유와 함께 RuleViolation */
  static assertAllowed(url: URL): void {
    if (url.protocol !== 'http:' && url.protocol !== 'https:')
      throw new RuleViolation('http · https 주소만 열 수 있어요');
    if (url.username || url.password)
      throw new RuleViolation('아이디 · 비밀번호가 든 주소는 열 수 없어요');
  }
}
