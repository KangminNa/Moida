import { Actor, Command, Rule, type Work } from '../../../apps/server/src/plugin-api';
import { JobView, LoginNoticedView } from './click-views';
import { buildPartOf } from './integration-build';
import { leasedBrowse, pageUrlOf, placeOf } from './job';
import { loginFormOf, savedForm } from './login-card';
import { type LoginForm, LoginTrust } from './login-inbox';
import { noteBrowse } from './repeats';
import { sites } from './schema';
import { addShot, decodeImage, imageOf } from './shots';
import { siteForPage } from './sites';

// 러너가 빌린 browse 작업의 자리(사이트 · 둘러보기)와 로그인 필요. 로그인 필요의 결재(browser.site.login)는 러너가 올리고,
// 관리자가 콘솔 화면에서 로그인한 뒤 "로그인했어요"(그 결재의 수정 요청)를 누르면 표시를 비우고 같은 작업이 이어서 돈다 (approvals.ts)

/**
 * MCP browser_job: 러너가 빌린 browse 작업이 어디서 도는지 (사이트 · 둘러보기, 로그인 필요, 앞에서 붙잡은 페이지,
 * 사이트 도구를 굳히는 일이면 그 몫). 굳히기면 그 작업을 쥔 것을 도구에 적어서 쓰기 동작이다
 */
export class BrowserJob extends Command<{ taskId: string }> {
  readonly name = 'job';
  readonly allow = Actor.RUN;

  input(raw: unknown): { taskId: string } {
    return this.fields(raw, (f) => ({ taskId: f.uuid('task_id') }));
  }

  async run(work: Work, actor: Actor, input: { taskId: string }): Promise<JobView> {
    const job = await leasedBrowse(work, input.taskId);
    const place = await placeOf(work, actor, job);
    // 보통 사이트 일이면 되풀이를 센다 (굳히기 · 클릭 고치기는 빼고, 2026-11-16 MCP 3단계)
    if (place.site && !place.held && !place.integration)
      await noteBrowse(work, place.site, job.id, job.instruction);
    const build = place.integration
      ? await buildPartOf(work, place.integration, input.taskId)
      : null;
    return new JobView(place.site, place.held, build);
  }
}

type LoginInput = {
  taskId: string;
  pageUrl: string;
  title: string;
  image: string | null;
  form: Omit<LoginForm, 'page_url' | 'runner_id'> | null;
};

/**
 * MCP browser_login_needed: 브라우저 일이 로그인 화면을 만났다. 사이트에 적고 그 화면을 남긴다 (러너). 결재는 러너가 올린다.
 * 둘러보기(대상 없음)면 그 주소의 출처로 사이트를 찾거나 만든다 (등록 없이, 2026-11-19): 로그인 결재의 대상이 그 사이트라
 * "로그인했어요" 뒤에 같은 작업이 그 사이트의 일로 이어서 돈다.
 * 러너가 확인한 로그인 칸(form)은 믿는 출처일 때만 사이트에 적는다 (로그인 카드, 2026-11-19): 사이트와 같은 도메인이고,
 * 관리자가 등록 · 로그인한 사이트이거나 관리자가 쓴 지시에 그 도메인이 있을 때. 아니면 칸을 비워 화면에서 직접 로그인한다
 */
export class LoginNeeded extends Command<LoginInput> {
  readonly name = 'loginNeeded';
  readonly allow = Actor.RUN;

  input(raw: unknown): LoginInput {
    return this.fields(raw, (f) => ({
      taskId: f.uuid('task_id'),
      pageUrl: pageUrlOf(f, 'page_url'),
      title: f.optionalText('page_title', 300) ?? '',
      image: imageOf(f, 'image', false),
      form: loginFormOf(f),
    }));
  }

  async run(work: Work, actor: Actor, input: LoginInput): Promise<LoginNoticedView> {
    const job = await leasedBrowse(work, input.taskId);
    const place = await placeOf(work, actor, job);
    const site = place.site ?? (await siteForPage(work, actor, input.pageUrl));
    const space = actor.requireSpace();
    const page = new URL(input.pageUrl);
    const trusted =
      site.origins.some((o) => LoginTrust.sameDomain(new URL(o).hostname, page.hostname)) &&
      (site.trusted_at !== null || LoginTrust.mentioned(job.ownerText, page.hostname));
    const form: LoginForm | null =
      input.form && trusted
        ? { ...input.form, page_url: input.pageUrl, runner_id: actor.id ?? '' }
        : null;
    // 판은 올리지 않는다: 러너의 표시가 관리자의 사이트 편집과 부딪히지 않게.
    // 칸을 보내지 않으면(이미 로그인 필요가 적힌 사이트 · 캡차 같은 화면) 앞에서 적은 칸을 그대로 둔다
    await work.updateRows(
      sites,
      input.form ? { login_needed_at: Rule.now, login_form: form } : { login_needed_at: Rule.now },
      { id: site.id, space_id: space },
    );
    if (input.image)
      await addShot(work, space, input.taskId, 'login', decodeImage(input.image), {
        url: input.pageUrl,
        title: input.title,
      });
    return new LoginNoticedView(site, input.form ? form !== null : savedForm(site) !== null);
  }
}
