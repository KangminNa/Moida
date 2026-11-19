import { createHmac, timingSafeEqual } from 'node:crypto';
import type { SecretBox } from '../../platform';

// 공유 링크의 토큰 (결과물 공유, 기획서 결정 2026-11-19): "<공유 id>.<서명>".
// 서명은 서버 키에서 이 용도로 나눈 열쇠(SecretBox.derive)로 만든 HMAC이라, 토큰을 저장하지 않아도 같은 링크를 다시 보여 줄 수 있고
// id만 알아서는 링크를 만들지 못한다. 서버 키를 바꾸면 이전 링크는 열리지 않는다 (derive는 늘 지금 키. 기간이 짧은 링크라 괜찮다)
export class ShareLink {
  /** 웹의 공개 주소 (next.config가 서버의 open으로 넘긴다) */
  static readonly PATH = '/share/';
  private static readonly LABEL = 'output-share';
  private static readonly UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

  /** 공유 하나의 공개 주소 */
  static path(box: SecretBox, id: string): string {
    return `${ShareLink.PATH}${id}.${ShareLink.sign(box, id)}`;
  }

  /** 이 서버가 만든 토큰이면 공유 id, 아니면 null (서명은 길이 · 내용을 한 번에 비교한다) */
  static idOf(box: SecretBox, token: string): string | null {
    const dot = token.indexOf('.');
    const id = token.slice(0, dot);
    if (dot < 0 || !ShareLink.UUID.test(id)) return null;
    const want = Buffer.from(ShareLink.sign(box, id));
    const got = Buffer.from(token.slice(dot + 1));
    return want.length === got.length && timingSafeEqual(want, got) ? id : null;
  }

  private static sign(box: SecretBox, id: string): string {
    return createHmac('sha256', box.derive(ShareLink.LABEL)).update(id).digest('base64url');
  }
}
