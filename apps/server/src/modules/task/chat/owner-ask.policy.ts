import { RuleViolation } from '../../platform';
import type { OwnerAskScope } from '../approval/app-approval.policy';

// 관리자가 대화에서 앱의 배포 · 수정을 직접 요청했는가 (2026-11-24, 원칙 7의 예외, 기획서 결정).
// 대표(AI)가 "관리자가 그렇게 말했다"고 주장하는 것을 믿지 않고, 인용한 말이 관리자가 콘솔에서 보낸 메시지에 글자 그대로 있는지 본다
// (ChatRepository.ownerWords: 기기 · 기능 패키지(텔레그램) · 자동화 · 서버가 연 회차는 빠진다). 그 말에 배포 · 공개 말이 있으면 ship,
// 고치기 말만 있으면 edit. 인용 바로 뒤에 "하지 마" 같은 말이 붙어 있으면 거절한다 ("배포는 하지 마"의 "배포"만 떼어 쓰지 못하게)
// biome-ignore lint/complexity/noStaticOnlyClass: 상태 없는 판단 한 곳
export class OwnerAsk {
  static readonly QUOTE_MIN = 2;
  static readonly QUOTE_MAX = 300;
  private static readonly SHIP =
    /배포|공개|오픈|출시|런칭|올려|띄워|deploy|publish|launch|release|go live/i;
  private static readonly EDIT =
    /고쳐|고치|수정|바꿔|바꾸|변경|반영|적용|추가|넣어|빼|지워|없애|update|fix|change/i;
  /** 인용 바로 뒤에서 요청을 뒤집는 말 */
  private static readonly NEGATION =
    /하지\s*마|하지\s*말|말고|말아|않|안\s*돼|금지|보류|기다려|나중에|don'?t|do not|not yet|hold/i;
  /** 인용 뒤에서 뒤집는 말을 찾는 길이 */
  private static readonly TAIL = 15;

  /** 인용한 말의 범위. 관리자의 말이 아니거나 요청이 아니면 RuleViolation */
  static scopeOf(quote: string, ownerWords: readonly string[]): OwnerAskScope {
    const said = OwnerAsk.flat(quote);
    if (said.length < OwnerAsk.QUOTE_MIN || said.length > OwnerAsk.QUOTE_MAX)
      throw new RuleViolation(
        `관리자의 말을 ${OwnerAsk.QUOTE_MIN}~${OwnerAsk.QUOTE_MAX}자로 그대로 인용해요`,
      );
    const message = ownerWords.map(OwnerAsk.flat).find((w) => w.includes(said));
    if (message === undefined)
      throw new RuleViolation(
        '이 대화에서 관리자가 콘솔로 보낸 말이 아니에요. 24시간 안의 관리자 메시지를 글자 그대로 인용해요',
      );
    const at = message.indexOf(said);
    const around = message.slice(at, at + said.length + OwnerAsk.TAIL);
    if (OwnerAsk.NEGATION.test(around))
      throw new RuleViolation('하지 말라는 말이에요. 배포 · 수정을 요청한 말을 인용해요');
    if (OwnerAsk.SHIP.test(said)) return 'ship';
    if (OwnerAsk.EDIT.test(said)) return 'edit';
    throw new RuleViolation(
      '배포 · 공개나 수정을 요청한 말이 아니에요 (예: "배포해줘", "버튼 색 바꿔줘")',
    );
  }

  private static flat(text: string): string {
    return text.replace(/\s+/g, ' ').trim().toLowerCase();
  }
}
