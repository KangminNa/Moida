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
