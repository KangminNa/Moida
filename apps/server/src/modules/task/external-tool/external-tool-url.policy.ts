import { isIP } from 'node:net';
import { RuleViolation } from '../../platform';

// 외부 도구(원격 MCP 서버)의 주소 규칙 (2차 7단계). 러너는 이 주소로 바로 붙으므로 바깥의 공개 서비스만 받는다.
// 이름을 풀어 보지 않고 모양으로만 막는다: 사람이 보고 승인하는 주소이고, 러너가 붙을 때는 일반 인터넷의 러너다.
// 막는 것: https가 아닌 주소, 주소 안의 계정, IP 주소, 점이 없는 이름(내부망), localhost · .local · .internal · .localhost
// biome-ignore lint/complexity/noStaticOnlyClass: 상태 없는 판단 한 곳. ExternalTool의 규칙이 쓴다
export class ExternalToolUrl {
  static readonly MAX = 500;
  private static readonly INTERNAL = /(^|\.)(localhost|local|internal|lan|home|corp)$/;

  /** 들어온 주소를 검사하고 정리한 주소(URL 그대로)를 돌려준다 */
  static check(value: string): string {
    const text = value.trim();
    let url: URL;
    try {
      url = new URL(text);
    } catch {
      throw new RuleViolation('주소 형식이 아니에요');
    }
    if (text.length > ExternalToolUrl.MAX)
      throw new RuleViolation(`주소는 ${ExternalToolUrl.MAX}자까지예요`);
    if (url.protocol !== 'https:') throw new RuleViolation('https 주소만 돼요');
    if (url.username || url.password)
      throw new RuleViolation('주소에 계정을 넣지 않아요. 토큰은 따로 넣어요');
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (isIP(host) !== 0) throw new RuleViolation('IP 주소가 아니라 도메인으로 넣어요');
    if (!host.includes('.') || ExternalToolUrl.INTERNAL.test(host))
      throw new RuleViolation('내부망 주소는 붙일 수 없어요');
    return url.toString();
  }
}
