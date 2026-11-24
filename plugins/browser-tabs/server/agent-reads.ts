import {
  Actor,
  Command,
  Read,
  RuleViolation,
  type Work,
} from '../../../apps/server/src/plugin-api';
import { reads } from './schema';
import { PageReadListView } from './views';

// 일꾼의 화면 읽기 (2026-11-24 사용자 결정 "자바스크립트로 그리는 화면이어도 결국 가져올 수 있잖아, 탭 읽기도 기본 기능으로").
// read_url(서버가 HTML만 받음)은 자바스크립트로 그리는 페이지에서 껍데기만 받는다. 그래서 탭 읽기를 일꾼에게도 연다:
//   browser_read { request_id, urls } → 서버 러너(AI 없음)가 탭으로 열어 글자가 더 늘지 않을 때까지 내리며 기다린 뒤 읽는다
//   browser_read_result { ids, wait_seconds } → 다 읽을 때까지 기다려 제목 · 글자를 받는다
// 일꾼의 읽기는 로그인 없는 새 빈 컨텍스트에서 내부 주소를 막는 프록시로만 나간다 (러너 TabReader · BlankRoom, 둘러보기와 같은 길).
// 읽기만 하고 누르기 · 입력은 없어서 승인 없이 쓴다. 관리자의 탭 읽기(로그인된 프로필)는 reads.ts 그대로다

const URLS_MAX = 10;
const URL_MAX = 2000;
const WAIT_MAX = 30;
/** 공간마다 읽기를 기다리는 주소의 수 */
const QUEUE_MAX = 40;
/** 일꾼의 읽기를 남겨 두는 날 (글자가 커서 오래 두지 않는다) */
const KEEP_DAYS = 7;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type AskInput = { requestId: string; urls: readonly string[] };
type ResultInput = { ids: readonly string[]; waitSeconds: number };

/** 열어도 되는 주소의 모양 (http · https, 아이디 · 비밀번호 없음). 내부 주소는 러너의 프록시가 막는다 */
function urlProblem(url: string): string | null {
  if (!URL.canParse(url)) return `주소가 아니에요: ${url.slice(0, 100)}`;
  const parsed = new URL(url);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
    return 'http · https 주소만 읽어요';
  if (parsed.username || parsed.password) return '아이디 · 비밀번호가 든 주소는 읽지 않아요';
  return null;
}

/** MCP browser_read: 주소들을 서버 브라우저의 탭으로 읽어 달라고 한다 (에이전트). 같은 request_id면 앞의 것을 준다 */
export class AskPageReads extends Command<AskInput> {
  readonly name = 'askPageReads';
  readonly allow = Actor.AGENT_OUT;

  input(raw: unknown): AskInput {
    return this.fields(raw, (f) => {
      const urls = f.optionalTextList('urls', URLS_MAX, URL_MAX) ?? [];
      if (urls.length === 0) f.reject('urls', '읽을 주소를 하나 이상 주세요');
      return { requestId: f.text('request_id', 100), urls };
    });
  }

  async run(work: Work, actor: Actor, input: AskInput): Promise<PageReadListView> {
    const space = actor.requireSpace();
    const agent = actor.id ?? '';
    for (const url of input.urls) {
      const problem = urlProblem(url);
      if (problem) throw new RuleViolation(problem);
    }
    const keys = input.urls.map((_, i) => `${agent}:${input.requestId}:${i}`);
    const asked = await work.rows(
      reads,
      { space_id: space, request_id: keys },
      { order: ['request_id'] },
    );
    if (asked.length > 0) return new PageReadListView(asked, false);
    const [waiting] = await work.sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM browser_tabs.reads WHERE space_id = ${space} AND status = 'requested'`;
    if ((waiting?.n ?? 0) + input.urls.length > QUEUE_MAX)
      throw new RuleViolation(`읽을 주소가 ${QUEUE_MAX}개 넘게 밀려 있어요. 잠시 뒤 다시 맡겨요`);
    await work.sql`
      DELETE FROM browser_tabs.reads WHERE space_id = ${space} AND agent_id IS NOT NULL
        AND requested_at < now() - make_interval(days => ${KEEP_DAYS})`;
    await work.insertRows(
      reads,
      input.urls.map((url, i) => ({
        space_id: space,
        url,
        agent_id: agent,
        request_id: keys[i],
      })),
    );
    return new PageReadListView(
      await work.rows(reads, { space_id: space, request_id: keys }, { order: ['request_id'] }),
      false,
    );
  }
}

/** MCP browser_read_result: 맡긴 읽기들의 결과. 모두 끝나거나 wait_seconds가 지나면 답한다 (맡긴 에이전트만) */
export class PageReadResults extends Read<ResultInput> {
  readonly name = 'pageReadResults';
  readonly allow = Actor.AGENT_OUT;

  input(raw: unknown): ResultInput {
    return this.fields(raw, (f) => {
      const ids = f.optionalTextList('ids', URLS_MAX, 36) ?? [];
      if (ids.length === 0) f.reject('ids', 'browser_read의 id를 하나 이상 주세요');
      if (ids.some((id) => !UUID.test(id))) f.reject('ids', 'browser_read가 준 id예요');
      return {
        ids,
        waitSeconds: f.optionalInteger('wait_seconds', 0, WAIT_MAX) ?? 20,
      };
    });
  }

  async run(work: Work, actor: Actor, input: ResultInput): Promise<PageReadListView> {
    const where = { space_id: actor.requireSpace(), agent_id: actor.id ?? '', id: [...input.ids] };
    const deadline = Date.now() + input.waitSeconds * 1000;
    for (;;) {
      const rows = await work.rows(reads, where, { order: ['request_id'] });
      const pending = rows.some((r) => r.status === 'requested');
      if (!pending || Date.now() >= deadline) return new PageReadListView(rows, true);
      await new Promise((done) => setTimeout(done, 1000));
    }
  }
}
