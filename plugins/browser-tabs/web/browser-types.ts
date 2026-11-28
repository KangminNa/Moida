// browser-tabs 콘솔 화면이 함께 쓰는 모양. 화면은 react와 이 폴더만 가져오므로 서버가 내보내는 모양을 여기 적는다
// (server/views.ts · click-views.ts의 toJSON과 맞춘다).

export type Reply = { ok: true; data: unknown } | { ok: false; message: string };
export type Call = (method: string, path: string, body?: object) => Promise<Reply>;
export type Props = { call: Call; notify: (text: string) => void };

export type Site = {
  id: string;
  name: string;
  startUrl: string;
  origins: string[];
  version: number;
  updatedAt: string;
  loginNeededAt: string | null;
};

export type Click = {
  id: string;
  taskId: string;
  siteName: string | null;
  tabId: string;
  pageUrl: string;
  pageTitle: string;
  role: string;
  name: string;
  status: string;
  reason: string | null;
  afterUrl: string | null;
  version: number;
  createdAt: string;
};

/** 사이트 도구 (2026-11-16 MCP 2단계, server/integration-views.ts의 IntegrationView) */
export type Integration = {
  id: string;
  siteId: string;
  siteName: string;
  name: string;
  title: string;
  description: string;
  hint: string;
  status: string;
  /** read · write (2026-11-16 MCP 3단계) */
  mode: string;
  reviewerId: string | null;
  /** 지금 버전의 검토 (쓰기 도구) */
  review: { seq: number; verdict: string; notes: string; createdAt: string } | null;
  liveSeq: number | null;
  draftSeq: number | null;
  failStreak: number;
  runsOk: number;
  runsFailed: number;
  lastRunAt: string | null;
  lastError: string | null;
  version: number;
  updatedAt: string;
};

/** 사이트 도구의 상세 (IntegrationDetailView): 최근 버전과 실행 */
export type IntegrationDetail = {
  integration: Integration;
  revisions: {
    seq: number;
    passed: number;
    total: number;
    inputSchema: unknown;
    outputSchema: unknown;
    code: string;
    tests: { name: string; ok: boolean; problem: string | null; ms: number | null }[];
    createdAt: string;
  }[];
  runs: {
    id: string;
    version: number;
    seq: number;
    status: string;
    input: string | null;
    output: string | null;
    error: string | null;
    errorKind: string | null;
    ms: number | null;
    createdAt: string;
  }[];
};

/** 되풀이되는 일 제안 (server/review-views.ts의 SuggestionListView) */
export type Suggestion = {
  id: string;
  siteId: string;
  siteName: string;
  count: number;
  sample: string;
  /** 승인한 누르기 계획에서 기록한 쓰기 API로 바로 낸 제안이면 그 까닭. 되풀이 제안은 빈 글 */
  note: string;
  /** open · failed (못 만듦, C4): 굳히기가 실패해 까닭(failReason)을 남기고 retryAt까지 다시 굳히지 않는다 */
  status: string;
  failReason: string;
  retryAt: string | null;
  version: number;
  lastSeenAt: string;
};

/** 도구 만들기 폼을 채워 여는 값 (제안에서) */
export type BuildSeed = {
  key: string;
  siteId: string;
  hint: string;
  suggestionId: string | null;
  /** 폼의 처음 모드. 쓰기 API 제안이면 write */
  mode?: 'read' | 'write';
};
