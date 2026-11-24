import { pause } from './backoff';

/** 읽은 탭 하나: 제목과 보이는 글자 (서버 도구의 한도에 맞춰 자른다) */
export class TabText {
  static readonly TITLE_MAX = 300;
  static readonly BODY_MAX = 200_000;

  constructor(
    readonly title: string,
    readonly body: string,
  ) {}

  static of(title: unknown, body: unknown): TabText {
    return new TabText(
      String(title ?? '')
        .trim()
        .slice(0, TabText.TITLE_MAX),
      String(body ?? '')
        .trim()
        .slice(0, TabText.BODY_MAX),
    );
  }
}

/** 이 주소를 읽지 못함 (페이지의 문제). 이유는 주인에게 그대로 보인다 (주소의 경로 · 내용은 담지 않는다) */
export class TabUnreadable extends Error {}

/** 브라우저에 닿지 못함 (브라우저의 문제: 꺼짐 · 다시 뜨는 중). 읽기 실패로 남기지 않고 나중에 다시 한다 */
export class BrowserUnavailable extends Error {}

/** 탭 하나와 이야기하는 CDP(Chrome DevTools Protocol) 연결. 보내고 받기와 이벤트 기다리기만 한다 */
export class DevToolsSession {
  /** 명령 하나의 답을 기다리는 시간 (브라우저가 죽었거나 페이지의 스크립트가 멈춘 경우) */
  static readonly REPLY_MS = 30_000;
  private nextId = 1;
  private readonly waiting = new Map<number, (reply: Record<string, unknown> | Error) => void>();
  private readonly listeners = new Map<string, () => void>();
  /** 이벤트마다 부르는 것 (요청 기록 NetworkTap) */
  private readonly handlers = new Map<string, (params: Record<string, unknown>) => void>();

  private constructor(private readonly socket: WebSocket) {
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data)) as Record<string, unknown>;
      if (typeof message.id === 'number') this.settle(message.id, message);
      else if (typeof message.method === 'string') {
        this.listeners.get(message.method)?.();
        this.handlers.get(message.method)?.((message.params ?? {}) as Record<string, unknown>);
      }
    });
    socket.addEventListener('close', () => {
      for (const id of [...this.waiting.keys()])
        this.settle(id, new BrowserUnavailable('브라우저와의 연결이 끊겼어요'));
    });
  }

  /** 붙거나 실패하면 stop의 리스너를 뗀다 (러너는 stop 하나로 오래 돈다) */
  static open(url: string, stop: AbortSignal): Promise<DevToolsSession> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url);
      const fail = () => {
        stop.removeEventListener('abort', fail);
        socket.close();
        reject(new BrowserUnavailable('브라우저 탭에 붙지 못했어요'));
      };
      socket.addEventListener(
        'open',
        () => {
          stop.removeEventListener('abort', fail);
          resolve(new DevToolsSession(socket));
        },
        { once: true },
      );
      socket.addEventListener('error', fail, { once: true });
      stop.addEventListener('abort', fail, { once: true });
    });
  }

  send(method: string, params: object = {}): Promise<Record<string, unknown>> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => this.settle(id, new TabUnreadable(`브라우저가 답하지 않았어요: ${method}`)),
        DevToolsSession.REPLY_MS,
      );
      this.waiting.set(id, (reply) => {
        clearTimeout(timer);
        if (reply instanceof Error) return reject(reply);
        const error = reply.error as { message?: string } | undefined;
        if (error) reject(new TabUnreadable(`브라우저가 거절했어요: ${error.message ?? method}`));
        else resolve((reply.result ?? {}) as Record<string, unknown>);
      });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  /** 이벤트마다 handler를 부른다 (같은 이벤트는 마지막 것 하나) */
  on(method: string, handler: (params: Record<string, unknown>) => void): void {
    this.handlers.set(method, handler);
  }

  /** 이벤트 하나를 기다린다 (보내기 전에 걸어 둔다) */
  next(method: string): Promise<void> {
    return new Promise((resolve) => this.listeners.set(method, resolve));
  }

  close(): void {
    this.socket.close();
  }

  private settle(id: number, reply: Record<string, unknown> | Error): void {
    const done = this.waiting.get(id);
    this.waiting.delete(id);
    done?.(reply);
  }
}

// 브라우저의 탭으로 주소를 열어 읽는다 (browser-tabs 패키지의 러너 쪽).
// 브라우저는 CDP 주소로 붙는다: 내 컴퓨터면 --remote-debugging-port로 띄운 Chrome, 서버면 브라우저 컨테이너.
// 읽기만 한다: 새 탭을 열고, 다 뜨면 글자가 더 늘지 않을 때까지 아래로 내리며 기다린 뒤(자바스크립트로 그리는 화면 ·
// 내리면 더 불러오는 목록) 제목과 보이는 글자(innerText)를 가져오고, 그 탭을 닫는다. 클릭 · 입력 · 전송은 없다.
// 관리자의 읽기는 로그인된 프로필의 탭으로, 일꾼의 읽기(browser_read, 2026-11-24)는 새 빈 컨텍스트(쿠키 없음)에서
// 내부 주소를 막는 프록시(ExploreProxy)로만 나간다: 둘러보기와 같은 길이다.
// 라이브러리 없이 Node의 WebSocket으로 CDP를 직접 쓴다.
export class BrowserTabs {
  /** 탭이 다 뜰 때까지 기다리는 시간. 넘으면 그때까지 그려진 것을 읽는다 */
  static readonly LOAD_MS = 30_000;
  /** 다 뜬 뒤 글자가 더 늘지 않는지 보는 간격 */
  static readonly SETTLE_MS = 800;
  /** 글자가 늘지 않기를 기다리는 가장 긴 시간 */
  static readonly SETTLE_MAX_MS = 10_000;
  /** 탭에서 돌리는 읽기: 제목과 보이는 글자 */
  private static readonly READ =
    '({ title: document.title, body: document.body ? document.body.innerText : "" })';
  /** 아래로 내리고(더 불러오는 목록) 지금 글자 수를 센다 */
  private static readonly GROW =
    '(() => { window.scrollTo(0, document.documentElement.scrollHeight); return document.body ? document.body.innerText.length : 0; })()';

  constructor(
    /** CDP 주소 (예: http://127.0.0.1:9222) */
    private readonly endpoint: string,
  ) {}

  /**
   * 주소를 새 탭으로 열어 읽고 닫는다. http · https만.
   * 이 읽기의 기다림(fetch · 타이머)은 읽기마다 따로 둔 신호에 걸고 끝나면 끊는다: 러너의 stop은 오래 살아서
   * 거기에 걸면 리스너와 30초 타이머가 남는다 (멈출 때 프로세스가 그만큼 늦게 끝난다)
   */
  async read(url: string, stop: AbortSignal, proxy: string | null = null): Promise<TabText> {
    if (!/^https?:\/\//i.test(url)) throw new TabUnreadable('http · https 주소만 읽어요');
    const reading = new AbortController();
    const cut = () => reading.abort();
    if (stop.aborted) cut();
    else stop.addEventListener('abort', cut, { once: true });
    try {
      return await this.readIn(url, reading.signal, proxy);
    } finally {
      stop.removeEventListener('abort', cut);
      reading.abort();
    }
  }

  /** proxy가 있으면 새 빈 컨텍스트(쿠키 없음)를 그 프록시로 열어 읽고 컨텍스트째 지운다 */
  private async readIn(url: string, stop: AbortSignal, proxy: string | null): Promise<TabText> {
    const room = proxy ? await BlankRoom.open(this.endpoint, proxy, stop) : null;
    let target: { id: string; socket: string } | null = null;
    let session: DevToolsSession | null = null;
    try {
      target = room ? await room.newTab() : await this.newTab(stop);
      session = await DevToolsSession.open(target.socket, stop);
      await session.send('Page.enable');
      const loaded = session.next('Page.loadEventFired');
      const went = await session.send('Page.navigate', { url });
      if (typeof went.errorText === 'string' && went.errorText)
        throw new TabUnreadable(`주소를 열지 못했어요: ${went.errorText}`);
      // 다 뜨지 않아도(오래 여는 연결 · 큰 그림) 그때까지 그려진 것을 읽는다
      await Promise.race([loaded, pause(BrowserTabs.LOAD_MS, stop)]);
      await this.settle(session, stop);
      const read = await session.send('Runtime.evaluate', {
        expression: BrowserTabs.READ,
        returnByValue: true,
      });
      const value = (read.result as { value?: { title?: unknown; body?: unknown } } | undefined)
        ?.value;
      return TabText.of(value?.title, value?.body);
    } finally {
      session?.close();
      if (room) await room.close();
      else if (target) await this.closeTab(target.id);
    }
  }

  /** 아래로 내리며 글자 수가 두 번 내리 그대로일 때까지 기다린다 (SETTLE_MAX_MS까지) */
  private async settle(session: DevToolsSession, stop: AbortSignal): Promise<void> {
    const until = Date.now() + BrowserTabs.SETTLE_MAX_MS;
    let last = -1;
    let same = 0;
    while (Date.now() < until && same < 2) {
      await pause(BrowserTabs.SETTLE_MS, stop);
      const grew = await session.send('Runtime.evaluate', {
        expression: BrowserTabs.GROW,
        returnByValue: true,
      });
      const length = Number((grew.result as { value?: unknown } | undefined)?.value ?? 0);
      same = length === last && length > 0 ? same + 1 : 0;
      last = length;
    }
  }

  /** 빈 탭 하나를 연다 (Chrome은 /json/new를 PUT으로만 받는다) */
  private async newTab(stop: AbortSignal): Promise<{ id: string; socket: string }> {
    let res: Response;
    try {
      res = await fetch(`${this.endpoint}/json/new?about:blank`, { method: 'PUT', signal: stop });
    } catch (error) {
      throw new BrowserUnavailable(
        `브라우저(${this.endpoint})에 닿지 못했어요: ${(error as Error).message}`,
      );
    }
    if (!res.ok) throw new BrowserUnavailable(`브라우저가 새 탭을 열지 않았어요 (${res.status})`);
    const target = (await res.json()) as { id?: string; webSocketDebuggerUrl?: string };
    if (!target.id || !target.webSocketDebuggerUrl)
      throw new BrowserUnavailable('브라우저의 답에 탭 주소가 없어요');
    return { id: target.id, socket: target.webSocketDebuggerUrl };
  }

  private async closeTab(id: string): Promise<void> {
    await fetch(`${this.endpoint}/json/close/${id}`).catch(() => undefined);
  }
}

/**
 * 일꾼의 읽기 한 번을 위한 새 빈 브라우저 컨텍스트 (쿠키 · 로그인 없음). 그 컨텍스트만 프록시로 나간다.
 * `<-loopback>`: Chrome이 localhost를 프록시 없이 보내는 것을 끈다 (이 서버 · 내부 주소는 프록시가 막는다)
 */
class BlankRoom {
  private constructor(
    private readonly session: DevToolsSession,
    private readonly socketBase: string,
    private readonly contextId: string,
  ) {}

  static async open(endpoint: string, proxy: string, stop: AbortSignal): Promise<BlankRoom> {
    let res: Response;
    try {
      res = await fetch(`${endpoint}/json/version`, { signal: stop });
    } catch (error) {
      throw new BrowserUnavailable(
        `브라우저(${endpoint})에 닿지 못했어요: ${(error as Error).message}`,
      );
    }
    const info = (await res.json().catch(() => ({}))) as { webSocketDebuggerUrl?: string };
    if (!res.ok || !info.webSocketDebuggerUrl)
      throw new BrowserUnavailable('브라우저의 답에 연결 주소가 없어요');
    const session = await DevToolsSession.open(info.webSocketDebuggerUrl, stop);
    try {
      const made = await session.send('Target.createBrowserContext', {
        disposeOnDetach: true,
        proxyServer: proxy,
        proxyBypassList: '<-loopback>',
      });
      const contextId = String(made.browserContextId ?? '');
      if (!contextId) throw new BrowserUnavailable('브라우저가 빈 컨텍스트를 열지 않았어요');
      const base = new URL(info.webSocketDebuggerUrl);
      return new BlankRoom(session, `${base.protocol}//${base.host}`, contextId);
    } catch (error) {
      session.close();
      throw error;
    }
  }

  async newTab(): Promise<{ id: string; socket: string }> {
    const made = await this.session.send('Target.createTarget', {
      url: 'about:blank',
      browserContextId: this.contextId,
    });
    const id = String(made.targetId ?? '');
    if (!id) throw new BrowserUnavailable('브라우저가 새 탭을 열지 않았어요');
    return { id, socket: `${this.socketBase}/devtools/page/${id}` };
  }

  /** 컨텍스트째 지운다 (탭 · 쿠키 · 저장소 모두) */
  async close(): Promise<void> {
    await this.session
      .send('Target.disposeBrowserContext', { browserContextId: this.contextId })
      .catch(() => undefined);
    this.session.close();
  }
}
