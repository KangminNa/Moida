import { BaseGateway } from '../../../apps/server/src/plugin-api';
import type { BrowserScreenGateway } from './screen.gateway';
import { type ScreenAction, ScreenActions, type Send } from './screen-actions';

// 서버 브라우저 화면 흘려보내기 (2026-11-26 "브라우저가 끊기듯이 동작"): 1초마다 그림을 새로 찍던 것을
// 탭에 오래 붙어(웹소켓 하나) Chrome이 화면이 바뀔 때마다 보내는 그림(Page.startScreencast)을 받아 두는 것으로 바꿨다.
// 콘솔은 "이 번호보다 새 그림"을 묻고(GET screen?after=), 새 그림이 오면 바로 · 없으면 몇 초 기다렸다 답한다.
// 클릭 · 글자도 같은 연결로 보내 매번 붙고 떼는 시간이 없다. 아무도 보지 않으면 30초 뒤 떼고 흘려보내기를 멈춘다.
// 그림 · 입력한 글자는 메모리의 마지막 그림 하나 말고는 어디에도 남기지 않는다 (screen.gateway.ts와 같다).

/** 흘려보낸 그림 하나: 번호(새 그림일수록 크다) · JPEG(base64) · 그림이 덮는 화면의 크기(CSS 픽셀, 클릭 좌표의 기준) */
export type CastFrame = { seq: number; image: string; width: number; height: number };

/** 탭 하나에 오래 붙은 연결: 흘려보낸 마지막 그림을 들고, 새 그림을 기다리는 쪽을 깨운다 */
class Cast {
  frame: CastFrame | null = null;
  usedAt = Date.now();
  closed = false;
  private seq = 0;
  private next = 0;
  private readonly waiting = new Map<
    number,
    { ok: (v: Record<string, unknown>) => void; fail: (e: Error) => void }
  >();
  private readonly wakers = new Set<() => void>();

  private constructor(private readonly socket: WebSocket) {}

  /** 붙고 흘려보내기를 시작한다. 시작 뒤 그림이 곧 오지 않으면(가려진 탭 등) 한 번 찍어 둔다 */
  static open(url: string, settings: object, firstMs: number, signal: AbortSignal): Promise<Cast> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url);
      const cast = new Cast(socket);
      const giveUp = () => {
        reject(new Error('탭에 붙지 못했어요 (시간이 지났어요)'));
        cast.close();
      };
      signal.addEventListener('abort', giveUp, { once: true });
      socket.onerror = () => reject(new Error('탭에 붙지 못했어요'));
      socket.onclose = () => cast.end(new Error('탭과의 연결이 끊겼어요'));
      socket.onmessage = (event) => cast.receive(String(event.data));
      socket.onopen = () => {
        cast.send('Page.startScreencast', settings).then(() => {
          signal.removeEventListener('abort', giveUp);
          resolve(cast);
          setTimeout(() => {
            if (!cast.frame && !cast.closed) void cast.capture().catch(() => undefined);
          }, firstMs);
        }, reject);
      };
    });
  }

  readonly send: Send = (method, params = {}) =>
    new Promise((ok, fail) => {
      if (this.closed) {
        fail(new Error('탭과의 연결이 끊겼어요'));
        return;
      }
      this.next += 1;
      this.waiting.set(this.next, { ok, fail });
      this.socket.send(JSON.stringify({ id: this.next, method, params }));
    });

  /** after보다 새 그림이 오거나 ms가 지날 때까지 기다린다 */
  waitNewer(after: number, ms: number): Promise<void> {
    if ((this.frame?.seq ?? 0) > after || this.closed) return Promise.resolve();
    return new Promise((resolve) => {
      const wake = () => {
        clearTimeout(timer);
        this.wakers.delete(wake);
        resolve();
      };
      const timer = setTimeout(wake, ms);
      this.wakers.add(wake);
    });
  }

  close(): void {
    if (this.closed) return;
    void this.send('Page.stopScreencast').catch(() => undefined);
    this.end(new Error('흘려보내기를 멈췄어요'));
    this.socket.close();
  }

  /** 지금 보이는 자리를 한 번 찍어 그림으로 둔다 (흘려보내기가 아직 그림을 주지 않을 때) */
  private async capture(): Promise<void> {
    const metrics = await this.send('Page.getLayoutMetrics');
    const view = metrics.cssVisualViewport as {
      pageX?: number;
      pageY?: number;
      clientWidth: number;
      clientHeight: number;
    };
    const picture = await this.send('Page.captureScreenshot', {
      format: 'jpeg',
      quality: ScreenCastGateway.QUALITY,
      clip: {
        x: view.pageX ?? 0,
        y: view.pageY ?? 0,
        width: view.clientWidth,
        height: view.clientHeight,
        scale: 1,
      },
    });
    if (!this.frame) this.keep(String(picture.data), view.clientWidth, view.clientHeight);
  }

  private receive(text: string): void {
    const message = JSON.parse(text) as {
      id?: number;
      method?: string;
      params?: Record<string, unknown>;
      result?: Record<string, unknown>;
      error?: { message?: string };
    };
    if (message.method === 'Page.screencastFrame' && message.params) {
      const p = message.params;
      const meta = (p.metadata ?? {}) as { deviceWidth?: number; deviceHeight?: number };
      // 받았다고 알려야 다음 그림이 온다 (콘솔이 느리면 Chrome도 천천히 보낸다)
      void this.send('Page.screencastFrameAck', { sessionId: p.sessionId }).catch(() => undefined);
      this.keep(String(p.data), meta.deviceWidth ?? 0, meta.deviceHeight ?? 0);
      return;
    }
    const w = message.id === undefined ? undefined : this.waiting.get(message.id);
    if (!w || message.id === undefined) return;
    this.waiting.delete(message.id);
    if (message.error) w.fail(new Error(message.error.message ?? '브라우저가 거절했어요'));
    else w.ok(message.result ?? {});
  }

  private keep(image: string, width: number, height: number): void {
    this.seq += 1;
    this.frame = { seq: this.seq, image, width: Math.round(width), height: Math.round(height) };
    for (const wake of [...this.wakers]) wake();
  }

  private end(error: Error): void {
    if (this.closed) return;
    this.closed = true;
    for (const w of this.waiting.values()) w.fail(error);
    this.waiting.clear();
    for (const wake of [...this.wakers]) wake();
  }
}

export class ScreenCastGateway extends BaseGateway {
  static readonly QUALITY = 60;
  /** 새 그림을 기다리는 가장 긴 시간. 화면이 그대로면 이만큼 뒤에 "그대로"로 답한다 */
  static readonly WAIT_MS = 5_000;
  /** 흘려보내기를 시작하고 첫 그림을 기다리는 시간 (지나면 한 번 찍는다) */
  private static readonly FIRST_MS = 1_200;
  /** 아무도 묻지 않으면 떼는 시간 */
  private static readonly IDLE_MS = 30_000;
  /** 함께 붙어 있을 탭 수 (콘솔 화면 · 승인 카드 몇 개) */
  private static readonly CASTS_MAX = 3;
  private static readonly SETTINGS = {
    format: 'jpeg',
    quality: ScreenCastGateway.QUALITY,
    maxWidth: 1600,
    maxHeight: 1600,
    everyNthFrame: 1,
  };

  protected readonly name = '서버 브라우저 화면';
  protected override readonly timeoutMs = 8_000;
  private readonly casts = new Map<string, Promise<Cast>>();

  constructor(private readonly screen: BrowserScreenGateway) {
    super();
    setInterval(() => this.sweep(), 5_000).unref();
  }

  /**
   * 탭의 그림 가운데 after보다 새 것. 없으면 waitMs까지 기다리고, 그래도 없으면 null (화면이 그대로).
   * after가 0이면 붙은 뒤 첫 그림을 기다린다
   */
  async frame(tab: string, after: number, waitMs: number): Promise<CastFrame | null> {
    const cast = await this.cast(tab);
    await cast.waitNewer(after, Math.min(waitMs, ScreenCastGateway.WAIT_MS));
    cast.usedAt = Date.now();
    const frame = cast.frame;
    return frame && frame.seq > after ? frame : null;
  }

  /**
   * 동작을 보낸다: 그 탭에 붙어 있으면 같은 연결로(빠르다), 아니면 한 번 붙어서.
   * 탭 열고 닫기는 탭 밖의 일이라 BrowserScreenGateway로 (새 탭이면 그 id를 돌려준다, 콘솔이 그 탭으로 옮긴다)
   */
  async control(tab: string, action: ScreenAction): Promise<string | null> {
    if (action.type === 'newTab') return this.screen.openTab(action.url);
    if (action.type === 'closeTab') {
      await this.screen.closeTab(tab);
      return null;
    }
    const live = this.casts.get(tab);
    const cast = live ? await live.catch(() => null) : null;
    if (!cast || cast.closed) await this.screen.control(tab, action);
    else {
      cast.usedAt = Date.now();
      await this.call(() => ScreenActions.act(cast.send, action));
    }
    return null;
  }

  /** 그 탭에 붙은 연결. 없거나 끊겼으면 새로 붙는다 (같은 탭을 함께 물으면 하나만 붙는다) */
  private async cast(tab: string): Promise<Cast> {
    const live = this.casts.get(tab);
    const ready = live ? await live.catch(() => null) : null;
    if (ready && !ready.closed) return ready;
    if (live && this.casts.get(tab) === live) this.casts.delete(tab);
    const other = this.casts.get(tab);
    if (other) return other;
    const opening = this.call(async (signal) => {
      const base = await this.screen.address();
      return Cast.open(
        `ws://${base}/devtools/page/${tab}`,
        ScreenCastGateway.SETTINGS,
        ScreenCastGateway.FIRST_MS,
        signal,
      );
    });
    this.casts.set(tab, opening);
    opening.catch(() => {
      if (this.casts.get(tab) === opening) this.casts.delete(tab);
    });
    this.trim();
    return opening;
  }

  /** 끊긴 연결과 오래 묻지 않은 연결을 뗀다 */
  private sweep(): void {
    const now = Date.now();
    for (const [tab, opening] of this.casts)
      void opening.then(
        (cast) => {
          if (!cast.closed && now - cast.usedAt < ScreenCastGateway.IDLE_MS) return;
          cast.close();
          if (this.casts.get(tab) === opening) this.casts.delete(tab);
        },
        () => undefined,
      );
  }

  /** 붙은 탭이 너무 많으면 가장 먼저 붙은 것부터 뗀다 */
  private trim(): void {
    while (this.casts.size > ScreenCastGateway.CASTS_MAX) {
      const [oldest] = this.casts.keys();
      if (oldest === undefined) return;
      const opening = this.casts.get(oldest);
      this.casts.delete(oldest);
      void opening?.then(
        (cast) => cast.close(),
        () => undefined,
      );
    }
  }
}
