import {
  Actor,
  Command,
  type LeasedWork,
  type RequestFields,
  RuleViolation,
  type Work,
} from '../../../apps/server/src/plugin-api';
import { RequestsSavedView } from './integration-views';
import { requestBuild } from './integrations';
import { leasedBrowse, placeOf } from './job';
import { integrations } from './schema';
import type { EndpointRow, SiteRow } from './tables';

// 브라우저 일을 API 도구로 (B2 · B3, 2026-11-19 사용자 결정 "최대한 브라우저가 아닌 MCP로, 브라우저로 들어가도 분석하고 MCP로 변환").
//   B2 요청 기록: 사이트 일 동안 러너(AI 없음)가 모은 그 사이트의 XHR · fetch 요청의 모양(값 없음)을 사이트에 남긴다 (browser_requests_save)
//   B3 API 도구 만들기: 처음으로 읽을 만한 API(GET · JSON 답)가 기록된 사이트면, 그 기록으로 화면 대신 API를 부르는(site.api)
//     읽기 사이트 도구를 저절로 굳히기 시작한다 (사이트마다 한 번, 설정 autoApiTools). 시험을 통과하면 바로 켜지고(B0),
//     다음부터 에이전트는 브라우저 대신 그 도구(site_run)로 일한다. 이번 일은 브라우저로 끝까지 한다 (기다리게 하지 않는다)

const METHOD = /^[A-Z]{3,7}$/;
const ORIGIN = /^https?:\/\/[a-z0-9.-]+(:\d{1,5})?$/;
const REQUESTS_MAX = 40;
const SHAPE_MAX = 4_000;
/** 굳히는 AI에게 싣는 기록 수 */
const ENDPOINTS_FOR_BUILD = 20;

type Request = Omit<
  EndpointRow,
  'id' | 'space_id' | 'site_id' | 'seen' | 'last_task_id' | 'created_at' | 'updated_at'
>;
type SaveInput = { taskId: string; requests: Request[] };

/** 모양 칸: JSON 글자(4,000자까지)를 읽는다. 없거나 JSON이 아니면 null */
function shapeOf(f: RequestFields, name: string): unknown {
  const text = f.optionalText(name, SHAPE_MAX);
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    f.reject(name, 'JSON 글자예요');
    return null;
  }
}

/** 사이트 도구의 이름: api_ + 사이트 호스트의 앞 낱말 (같은 이름이 있으면 뒤에 숫자) */
async function apiNameOf(work: Work, space: string, site: Readonly<SiteRow>): Promise<string> {
  const host = URL.canParse(site.start_url) ? new URL(site.start_url).hostname : 'site';
  const words = host
    .replace(/^www\./, '')
    .split('.')
    .slice(0, 2)
    .join('_')
    .replace(/[^a-z0-9_]/g, '_');
  const base = `api_${words}`.slice(0, 36);
  for (let i = 1; i < 20; i++) {
    const name = i === 1 ? base : `${base}_${i}`;
    if (!(await work.exists(integrations, { space_id: space, name }))) return name;
  }
  return `${base}_${Date.now() % 1000}`.slice(0, 40);
}

/**
 * MCP browser_requests_save { task_id, requests }: 사이트 일에서 기록한 요청의 모양을 남긴다 (그 작업의 임대를 쥔 러너만).
 * 사이트의 허용 출처로 간 것만, 같은 모양은 횟수를 올린다. 그 뒤 API 도구를 만들 차례면 굳히기를 맡긴다 (building)
 */
export class SaveRequests extends Command<SaveInput> {
  readonly name = 'saveRequests';
  readonly allow = Actor.RUN;

  constructor(private readonly autoApiTools: boolean) {
    super();
  }

  input(raw: unknown): SaveInput {
    return this.fields(raw, (f) => ({
      taskId: f.uuid('task_id'),
      requests: f.nestedList('requests', REQUESTS_MAX).map((r) => {
        const method = r.text('method', 7);
        const origin = r.text('origin', 200);
        const path = r.text('path', 300);
        if (method && !METHOD.test(method)) r.reject('method', 'GET · POST 같은 방법이에요');
        if (origin && !ORIGIN.test(origin)) r.reject('origin', 'http(s)://호스트예요');
        if (path && !path.startsWith('/')) r.reject('path', '/로 시작해요');
        return {
          method,
          origin,
          path,
          query: [...(r.optionalTextList('query', 20, 60) ?? [])],
          body: shapeOf(r, 'body'),
          response: shapeOf(r, 'response'),
          status: r.optionalInteger('status', 0, 999) ?? 0,
          content_type: r.optionalText('content_type', 100) ?? '',
        };
      }),
    }));
  }

  async run(work: Work, actor: Actor, input: SaveInput): Promise<RequestsSavedView> {
    const job = await leasedBrowse(work, input.taskId);
    const { site } = await placeOf(work, actor, job);
    if (!site) throw new RuleViolation('둘러보기에서는 기록하지 않아요');
    const space = actor.requireSpace();
    const kept = input.requests.filter((r) => site.origins.includes(r.origin));
    const json = (shape: unknown) => (shape === null ? null : work.sql.json(shape as never));
    for (const r of kept)
      await work.sql`
        INSERT INTO browser_tabs.endpoints
          (space_id, site_id, method, origin, path, query, body, response, status, content_type, last_task_id)
        VALUES (${space}, ${site.id}, ${r.method}, ${r.origin}, ${r.path}, ${r.query},
          ${json(r.body)}, ${json(r.response)},
          ${r.status}, ${r.content_type}, ${job.id})
        ON CONFLICT (site_id, method, origin, path) DO UPDATE SET
          query = EXCLUDED.query, body = EXCLUDED.body, response = EXCLUDED.response,
          status = EXCLUDED.status, content_type = EXCLUDED.content_type,
          seen = browser_tabs.endpoints.seen + 1, last_task_id = EXCLUDED.last_task_id, updated_at = now()`;
    const building = this.autoApiTools && (await this.startBuild(work, space, site, job));
    return new RequestsSavedView(kept.length, building);
  }

  /**
   * 사이트의 첫 API 도구를 굳히기 시작한다: 아직 시작한 적 없고 · 그 사이트에 도구가 없고 · 읽을 만한 API(GET · JSON 답)가 있을 때.
   * 담당은 browse 권한이 있는 에이전트 아무나 (코어가 고른다)
   */
  private async startBuild(
    work: Work,
    space: string,
    site: Readonly<SiteRow>,
    job: LeasedWork,
  ): Promise<boolean> {
    if (site.api_build_at !== null) return false;
    if (await work.exists(integrations, { space_id: space, site_id: site.id })) return false;
    const [readable] = await work.sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM browser_tabs.endpoints
      WHERE site_id = ${site.id} AND method = 'GET' AND response IS NOT NULL AND status BETWEEN 200 AND 299`;
    if ((readable?.n ?? 0) === 0) return false;
    const marked = await work.sql`
      UPDATE browser_tabs.sites SET api_build_at = now()
      WHERE id = ${site.id} AND space_id = ${space} AND api_build_at IS NULL RETURNING id`;
    if (marked.length === 0) return false;
    const name = await apiNameOf(work, space, site);
    await work.insertRows(integrations, {
      space_id: space,
      site_id: site.id,
      name,
      title: `${site.name} API`.slice(0, 60),
      description: `${site.name}에서 하는 읽기를 화면 대신 사이트의 API로 하는 도구`.slice(0, 300),
      hint: [
        '브라우저 일에서 기록한 API(아래 기록된 API)로 만든다. 화면 대신 site.api로 부르고, API로 안 되는 것만 page로 읽는다.',
        job.instruction ? `처음 기록한 일의 지시: ${job.instruction.slice(0, 1_000)}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
      agent_id: null,
      mode: 'read',
      reviewer_id: null,
    });
    const row = await work.row(integrations, { space_id: space, name });
    if (!row) return false;
    requestBuild(work, space, row, `api:${site.id}`, null);
    return true;
  }
}

/** 굳히는 AI에게 싣는 그 사이트의 기록 (읽을 만한 GET · JSON 답이 먼저) */
export async function endpointsFor(work: Work, siteId: string): Promise<EndpointRow[]> {
  return work.sql<EndpointRow[]>`
    SELECT * FROM browser_tabs.endpoints WHERE site_id = ${siteId}
    ORDER BY (method = 'GET' AND response IS NOT NULL) DESC, seen DESC, updated_at DESC
    LIMIT ${ENDPOINTS_FOR_BUILD}`;
}
