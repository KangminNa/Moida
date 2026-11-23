import type { LinkRow } from './tables';

// 이 패키지가 내보내는 모양 (콘솔은 camelCase)

/** 이어 둔 텔레그램 계정 하나 (콘솔) */
export class LinkView {
  constructor(private readonly row: Readonly<LinkRow>) {}

  toJSON() {
    const r = this.row;
    return {
      id: r.id,
      name: r.name,
      currentChat: r.current_chat,
      createdAt: r.created_at.toISOString(),
    };
  }
}

/** 텔레그램 화면: 봇 설정이 갖춰졌는지와 이어 둔 계정들 */
export class LinkListView {
  constructor(
    private readonly links: readonly LinkView[],
    /** 봇 토큰 · 바깥 주소가 채워졌는가 (설정 › 플러그인) */
    private readonly ready: boolean,
  ) {}

  toJSON() {
    return { ready: this.ready, links: this.links.map((l) => l.toJSON()) };
  }
}

/** 새 연결 코드 (한 번만 보인다) */
export class PairingView {
  constructor(
    private readonly code: string,
    private readonly expiresAt: Date,
  ) {}

  toJSON() {
    return { code: this.code, expiresAt: this.expiresAt.toISOString() };
  }
}

/** 받거나 다룬 결과: 웹훅 · 이벤트로 도는 동작 (보는 사람이 없다) */
export class DoneView {
  constructor(private readonly handled: boolean) {}

  toJSON() {
    return { ok: true, handled: this.handled };
  }
}
