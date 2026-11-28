// Express 요청·응답 중 Controller·Guard가 쓰는 부분. 외부(Express) 객체의 모양을 가리키는 타입이라
// 여기 한 곳에만 두고, 진입 계층은 이것만 쓴다.

/** 들어온 HTTP 요청 */
export type HttpRequest = {
  method: string;
  /** 경로와 쿼리 (앞에서 바뀌기 전 그대로) */
  originalUrl?: string;
  headers: Record<string, unknown>;
  query: Record<string, unknown>;
  ip?: string;
  protocol: string;
  actor?: unknown;
  /** 요청 번호 (RequestTrace가 맨 앞에서 붙인다) */
  requestId?: string;
  /** 요청 로그에 덧붙일, 이 요청이 한 일 (MCP 도구 이름) */
  traced?: string;
  /** 성공하면 요청 로그에 남기지 않는다 (러너가 되풀이해 묻는 MCP 도구의 성공, BaseTool.polled) */
  quiet?: boolean;
  /** 앱 도메인으로 온 요청이면 그 도메인 (HostGate, 스토어 3-0). 관리자 쿠키 · 토큰은 보지 않는다 */
  appHost?: string;
  /** 그 도메인의 앱과 앱이 든 공간 (HostGate, 스토어 3-1: 커뮤니티가 어느 앱인지, 이벤트 · 알림이 어느 공간인지 안다) */
  appId?: string;
  appSpaceId?: string;
  /** 공통 앱 도메인(MOIDA_APPS_URL, 2026-11-27)으로 온 요청인가. 앱은 경로의 첫 칸이라 웹이 x-moida-app 머리글로 알린다 (appId가 없을 수도 있다) */
  appsDomain?: boolean;
  /** 기본 도메인으로 온 요청이면 그 공간 (HostGate, 2026-11-26: 스토어 가입이 어느 스토어인지) */
  siteSpaceId?: string;
};

/** 본문을 흘려 읽는 요청 (JSON으로 읽지 않은 본문: 결과물 올리기). 받는 쪽이 크기를 세며 읽는다 */
export type HttpUpload = HttpRequest & AsyncIterable<Uint8Array>;

/** 나가는 HTTP 응답 (머리글, 쿠키, 다른 주소로 보내기) */
export type HttpResponse = {
  setHeader(name: string, value: string): void;
  cookie(name: string, value: string, options: object): void;
  clearCookie(name: string, options: object): void;
  redirect(status: number, url: string): void;
};
