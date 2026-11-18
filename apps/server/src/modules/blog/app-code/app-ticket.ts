import { NotFound, type SecretBox } from '../../platform';

// 앱 코드 미리 보기 토큰 (스토어 1-6). 앱 화면은 격리해서 열기 때문에(쿠키가 실리지 않는다) 관리자도 로그인으로 볼 수 없다:
// 주소에 토큰을 실어 그 앱 하나를 "공개된 것처럼" 보게 한다 (/<앱>/~<토큰>/…, 페이지의 PageTicket과 같은 모양).
// 서버 키로 봉인하고(용도 고정, 30분) 앱 하나에 묶인다. 버전에 묶은 토큰은 확인 대기 버전 · 지난 버전의 미리 보기이고,
// 묶지 않은 토큰은 지금 보이는 버전(없으면 시작 코드)이다 (비공개 앱 미리 보기).
export class AppTicket {
  /** 주소에서 토큰을 알아보는 앞 글자 (앱 안의 경로는 글자로 시작한다) */
  static readonly MARK = '~';
  private static readonly PURPOSE = 'app-view';
  private static readonly TTL_SECONDS = 30 * 60;

  constructor(
    readonly appId: string,
    /** 이 버전만 보인다. null이면 보이는 버전 */
    readonly seq: number | null = null,
  ) {}

  /** 봉인한 토큰 */
  seal(box: SecretBox, now: Date): string {
    const value = this.seq === null ? this.appId : `${this.appId}@${this.seq}`;
    return box.pack(AppTicket.PURPOSE, value, AppTicket.TTL_SECONDS, now);
  }

  /** 토큰을 연다. 없거나 · 틀리거나 · 끝났으면 없는 앱과 같다 (404) */
  static open(box: SecretBox, token: string, now: Date): AppTicket {
    const value = box.unpack(AppTicket.PURPOSE, token, now);
    if (value === null) throw new NotFound('없는 앱이에요');
    const [appId = '', seq] = value.split('@');
    return new AppTicket(appId, seq === undefined ? null : Number(seq));
  }
}
