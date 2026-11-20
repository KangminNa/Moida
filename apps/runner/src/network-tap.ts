import { type ApiCall, ApiShape } from './api-shape';
import type { BrowserPages } from './browser-page';
import { DevToolsSession } from './browser-tabs';

type Pending = {
  method: string;
  url: URL;
  body: string | null;
  bodyType: string;
  status: number;
  contentType: string;
};

// 요청 기록 (B2, 2026-11-19 사용자 결정 "브라우저로 들어가도 분석하고 MCP로 변환"). 사이트 일 동안 AI가 브라우저로 일하는 사이
// 러너(AI 없음)가 그 브라우저의 탭들에 CDP로 함께 붙어, 사이트의 허용 출처로 가는 XHR · fetch 요청의 모양만 모은다 (ApiShape: 값 없음).
// 일이 끝나면 browser_requests_save로 사이트에 남기고, 서버는 그것으로 화면 대신 API를 부르는 사이트 도구를 만든다 (B3).
// 듣기만 한다: 요청을 바꾸거나 막지 않고, 머리글 · 쿠키 · 값은 보지 않는다. 같은 모양(방법 · 출처 · 경로 틀)은 하나로 센다.
// 탭은 0.4초마다 찾아 붙는다: 새 탭이 붙기 전에 보낸 요청은 못 보지만, AI가 그 탭에서 이동 · 누르기를 하며 보내는 요청은 본다
export class NetworkTap {
  /** 남기는 요청 모양의 수 */
  static readonly MAX = 40;
  /** 붙는 탭의 수 */
  private static readonly TABS = 10;
  /** 새 탭을 찾는 간격 */
  private static readonly SCAN_MS = 400;
  /** 모양을 읽는 JSON 답의 크기 */
  private static readonly BODY_MAX = 512 * 1024;
  private static readonly TYPES = new Set(['XHR', 'Fetch']);
  private readonly sessions = new Map<string, DevToolsSession>();
  private readonly pending = new Map<string, Pending>();
  private readonly calls = new Map<string, ApiCall>();
  private timer: NodeJS.Timeout | null = null;
  private readonly stopper = new AbortController();

  constructor(
    private readonly pages: BrowserPages,
    private readonly origins: readonly string[],
  ) {}

  /** 탭을 찾아 붙기 시작한다 (실패해도 일을 막지 않는다) */
  start(): void {
    const scan = () => {
      void this.scan().finally(() => {
        if (!this.stopper.signal.aborted) this.timer = setTimeout(scan, NetworkTap.SCAN_MS);
      });
    };
    scan();
  }

  /** 붙은 탭을 모두 떼고 모은 모양을 돌려준다 */
  stop(): ApiCall[] {
    this.stopper.abort();
    if (this.timer) clearTimeout(this.timer);
    for (const s of this.sessions.values()) s.close();
    this.sessions.clear();
    return [...this.calls.values()];
  }

  private async scan(): Promise<void> {
    const tabs = await this.pages.tabs(this.stopper.signal).catch(() => []);
    for (const tab of tabs) {
      if (this.sessions.has(tab.id) || this.sessions.size >= NetworkTap.TABS) continue;
      const s = await DevToolsSession.open(tab.socket, this.stopper.signal).catch(() => null);
      if (!s) continue;
      this.sessions.set(tab.id, s);
      this.listen(tab.id, s);
      await s.send('Network.enable').catch(() => null);
    }
  }

  private listen(tabId: string, s: DevToolsSession): void {
    const key = (id: unknown) => `${tabId}:${String(id)}`;
    s.on('Network.requestWillBeSent', (p) => {
      const request = (p.request ?? {}) as { url?: string; method?: string; postData?: string };
      if (!NetworkTap.TYPES.has(String(p.type)) || !request.url || !URL.canParse(request.url))
        return;
      const url = new URL(request.url);
      if (!this.origins.includes(url.origin)) return;
      const headers = ((p.request as { headers?: Record<string, string> }).headers ?? {}) as Record<
        string,
        string
      >;
      const bodyType = headers['Content-Type'] ?? headers['content-type'] ?? '';
      this.pending.set(key(p.requestId), {
        method: String(request.method ?? 'GET').toUpperCase(),
        url,
        body: request.postData ?? null,
        bodyType,
        status: 0,
        contentType: '',
      });
    });
    s.on('Network.responseReceived', (p) => {
      const call = this.pending.get(key(p.requestId));
      const response = (p.response ?? {}) as { status?: number; mimeType?: string };
      if (call)
        Object.assign(call, { status: response.status ?? 0, contentType: response.mimeType ?? '' });
    });
    s.on('Network.loadingFinished', (p) => {
      const call = this.pending.get(key(p.requestId));
      this.pending.delete(key(p.requestId));
      if (call) void this.keep(s, String(p.requestId), call, Number(p.encodedDataLength ?? 0));
    });
  }

  /** 모양을 만들어 남긴다. JSON 답이면 본문을 읽어 모양을 더한다 */
  private async keep(s: DevToolsSession, requestId: string, call: Pending, size: number) {
    const id = `${call.method} ${call.url.origin}${ApiShape.pathOf(call.url.pathname)}`;
    if (!this.calls.has(id) && this.calls.size >= NetworkTap.MAX) return;
    let response: unknown = null;
    if (/json/i.test(call.contentType) && size <= NetworkTap.BODY_MAX) {
      const read = await s.send('Network.getResponseBody', { requestId }).catch(() => null);
      const text = read?.base64Encoded
        ? Buffer.from(String(read.body), 'base64').toString('utf8')
        : String(read?.body ?? '');
      try {
        response = ApiShape.shapeOf(JSON.parse(text), 0);
      } catch {
        response = null;
      }
    }
    this.calls.set(id, {
      method: call.method,
      origin: call.url.origin,
      path: ApiShape.pathOf(call.url.pathname),
      query: ApiShape.queryOf(call.url.searchParams),
      body: ApiShape.bodyOf(call.body, call.bodyType),
      status: call.status,
      contentType: call.contentType.slice(0, 100),
      response,
    });
  }
}
