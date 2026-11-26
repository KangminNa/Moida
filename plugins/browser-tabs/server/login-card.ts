import {
  Actor,
  NotFound,
  Operation,
  Read,
  type RequestFields,
  RuleViolation,
  type Work,
} from '../../../apps/server/src/plugin-api';
import {
  LOGIN_KINDS,
  LOGIN_PROVIDERS,
  type LoginForm,
  type LoginInbox,
  type LoginKind,
  type LoginRequest,
  type LoginValues,
  type ProviderForm,
} from './login-inbox';
import { LoginCardView, LoginSavedView, LoginSentView, NextLoginView } from './login-views';
import { sites } from './schema';
import { decodeImage, imageOf } from './shots';
import type { SiteRow } from './tables';

// 로그인 카드 (2026-11-19 사용자 결정, 원칙 8을 바꿈). AI는 로그인 화면의 칸(종류 · 역할 · 이름)만 알려 주고 값은 보지 않는다.
//   관리자: 대화의 로그인 승인 카드에서 칸에 넣는다 (POST sites/:id/login) → 값은 이 프로세스의 메모리에만 (LoginInbox)
//   러너(AI 없음, 그 로그인 화면을 연 러너): browser_login_next로 꺼내 그 사이트의 칸에 넣고 로그인 단추를 누른 뒤
//     browser_login_save로 결과와 화면을 남긴다 → 카드가 "로그인했어요"로 같은 작업을 잇는다 (코어의 결재는 관리자가 정한다)
// 칸은 믿는 출처일 때만 사이트에 적힌다 (LoginTrust, browse.ts의 LoginNeeded). 아니면 카드는 화면에서 직접 로그인하게 한다.

const ROLE = /^[a-z]{1,40}$/;
const VALUE_MAX: Record<LoginKind, number> = { id: 200, password: 200, code: 20 };

/** 접근성 역할 + 이름 (다시 찾을 단추 · 칸) */
function target(t: RequestFields) {
  const role = t.text('role', 40);
  if (role && !ROLE.test(role)) t.reject('role', '접근성 역할 이름이에요 (소문자)');
  return { role, name: t.text('name', 200) };
}

/**
 * 러너가 보낸 로그인 칸의 모양 (browser_login_needed의 form). 없으면 null.
 * 칸 0~3개(있으면 로그인 단추도) · 간편 로그인 단추 0~4개(회사마다 하나, 2026-11-26), 둘 가운데 하나는 있어야 한다
 */
export function loginFormOf(f: RequestFields): Omit<LoginForm, 'page_url' | 'runner_id'> | null {
  const raw = f.optionalRecord('form');
  if (Object.keys(raw).length === 0) return null;
  const form = f.nested('form');
  // 간편 로그인만 있는 화면은 fields가 없고, 칸만 있는 화면은 social이 없다
  const listOf = (name: string, max: number) =>
    raw[name] === undefined ? [] : form.nestedList(name, max);
  const fields = listOf('fields', 3).map((field) => {
    const kind = field.text('kind', 10);
    if (!LOGIN_KINDS.includes(kind as LoginKind)) field.reject('kind', 'id · password · code예요');
    return { kind: kind as LoginKind, ...target(field) };
  });
  if (new Set(fields.map((x) => x.kind)).size !== fields.length)
    form.reject('fields', '같은 종류의 칸이 둘이에요');
  const social = listOf('social', 4).map((button) => {
    const provider = button.text('provider', 20);
    if (!(provider in LOGIN_PROVIDERS))
      button.reject('provider', 'kakao · naver · google · apple예요');
    return { provider, ...target(button) };
  });
  if (new Set(social.map((x) => x.provider)).size !== social.length)
    form.reject('social', '같은 회사의 간편 로그인이 둘이에요');
  if (fields.length === 0 && social.length === 0)
    form.reject('fields', '칸이나 간편 로그인 단추가 하나는 있어야 해요');
  const submit = fields.length > 0 ? target(form.nested('submit')) : null;
  return { fields, submit, ...(social.length > 0 ? { social } : {}) };
}

/** 러너가 간편 로그인 뒤 그 회사의 화면에서 찾은 칸 (browser_login_save의 provider_form). 고정 목록의 https 호스트만 */
function providerFormOf(f: RequestFields): ProviderForm | null {
  if (Object.keys(f.optionalRecord('provider_form')).length === 0) return null;
  const form = f.nested('provider_form');
  const provider = form.text('provider', 20);
  const pageUrl = form.text('page_url', 2000);
  const hosts = LOGIN_PROVIDERS[provider] ?? [];
  const page = URL.canParse(pageUrl) ? new URL(pageUrl) : null;
  if (!page || page.protocol !== 'https:' || !hosts.includes(page.hostname))
    form.reject('page_url', '간편 로그인 회사의 https 로그인 화면이 아니에요');
  const fields = form.nestedList('fields', 2).map((field) => {
    const kind = field.text('kind', 10);
    if (kind !== 'id' && kind !== 'password') field.reject('kind', 'id · password예요');
    return {
      kind: kind === 'password' ? ('password' as const) : ('id' as const),
      ...target(field),
    };
  });
  if (fields.length !== 2 || fields[0]?.kind === fields[1]?.kind)
    form.reject('fields', '아이디 · 비밀번호 칸 둘이에요');
  return { provider, page_url: pageUrl, fields, submit: target(form.nested('submit')) };
}

/** 사이트의 로그인 칸. 적힌 모양이 틀리면 null (화면에서 직접 로그인) */
export function savedForm(row: Pick<SiteRow, 'login_form'>): LoginForm | null {
  const form = row.login_form as LoginForm | null;
  if (!form || !Array.isArray(form.fields)) return null;
  const social = Array.isArray(form.social) ? form.social : [];
  return (form.fields.length > 0 && form.submit) || social.length > 0 ? form : null;
}

async function siteIn(work: Work, actor: Actor, id: string): Promise<SiteRow> {
  const site = await work.row(sites, { id, space_id: actor.requireSpace() });
  if (!site) throw new NotFound('사이트를 찾을 수 없어요');
  return site;
}

/** GET /api/p/browser-tabs/sites/:id/login: 카드의 칸과 진행 상태 (관리자). 값은 돌려주지 않는다 */
export class LoginCard extends Read<{ id: string }> {
  readonly name = 'loginCard';
  readonly allow = Operation.OWNER;

  constructor(private readonly inbox: LoginInbox) {
    super();
  }

  input(raw: unknown): { id: string } {
    return this.fields(raw, (f) => ({ id: f.uuid('id') }));
  }

  async run(work: Work, actor: Actor, input: { id: string }): Promise<LoginCardView> {
    const site = await siteIn(work, actor, input.id);
    return new LoginCardView(site, savedForm(site), this.inbox.attempt(site.space_id, site.id));
  }
}

type SendInput = {
  id: string;
  values: LoginValues;
  /** 누를 간편 로그인 회사 (값 없이) */
  social: string | null;
  /** provider: 열린 간편 로그인 회사의 화면 칸에 넣기 */
  step: 'site' | 'provider';
};

/**
 * POST /api/p/browser-tabs/sites/:id/login { values } | { social } | { step: 'provider', values }: 카드에서 한 것 (관리자).
 * 값은 메모리에만 10분. 간편 로그인은 사이트에 적힌 회사만, 그 회사의 칸은 러너가 그 화면에서 찾은 것(opened 뒤)에만
 */
export class SendLogin extends Read<SendInput> {
  readonly name = 'sendLogin';
  readonly allow = Operation.OWNER;

  constructor(private readonly inbox: LoginInbox) {
    super();
  }

  input(raw: unknown): SendInput {
    return this.fields(raw, (f) => {
      const given = f.optionalRecord('values');
      const values: LoginValues = {};
      if (Object.keys(given).length > 0) {
        const nested = f.nested('values');
        for (const kind of LOGIN_KINDS) {
          const value = nested.optionalText(kind, VALUE_MAX[kind]);
          if (value !== null) values[kind] = value;
        }
      }
      const step = f.optionalText('step', 10) ?? 'site';
      if (step !== 'site' && step !== 'provider') f.reject('step', 'site · provider예요');
      return {
        id: f.uuid('id'),
        values,
        social: f.optionalText('social', 20),
        step: step === 'provider' ? 'provider' : 'site',
      };
    });
  }

  async run(work: Work, actor: Actor, input: SendInput): Promise<LoginSentView> {
    const site = await siteIn(work, actor, input.id);
    const form = savedForm(site);
    if (!form)
      throw new RuleViolation(
        '이 사이트는 칸으로 로그인할 수 없어요. 화면에서 직접 로그인해 주세요',
      );
    const request = this.requestOf(site, form, input);
    const kinds =
      request.kind === 'provider'
        ? request.form.fields
        : request.kind === 'values'
          ? form.fields
          : [];
    const missing = kinds.filter((f) => !input.values[f.kind]).map((f) => f.kind);
    const extra = Object.keys(input.values).filter((k) => !kinds.some((f) => f.kind === k));
    if (missing.length > 0 || extra.length > 0)
      throw new RuleViolation(`칸이 맞지 않아요 (빠진 칸 ${missing.join(', ') || '없음'})`);
    this.inbox.send(site.space_id, site.id, form.runner_id, input.values, Date.now(), request);
    return new LoginSentView(this.inbox.attempt(site.space_id, site.id));
  }

  private requestOf(site: SiteRow, form: LoginForm, input: SendInput): LoginRequest {
    if (input.social !== null) {
      if (!(form.social ?? []).some((s) => s.provider === input.social))
        throw new RuleViolation('이 사이트의 간편 로그인이 아니에요');
      return { kind: 'social', provider: input.social };
    }
    if (input.step === 'provider') {
      const opened = this.inbox.providerForm(site.space_id, site.id);
      if (!opened)
        throw new RuleViolation('열린 간편 로그인 화면이 없어요. 간편 로그인을 다시 눌러 주세요');
      return { kind: 'provider', form: opened };
    }
    if (form.fields.length === 0)
      throw new RuleViolation('이 사이트는 간편 로그인만 있어요. 간편 로그인 단추를 눌러 주세요');
    return { kind: 'values' };
  }
}

/** MCP browser_login_next: 이 러너가 넣을 로그인 하나 (값과 칸). 꺼내면 메모리에서 지운다. 없으면 login: null */
export class NextLogin extends Read<null> {
  readonly name = 'nextLogin';
  readonly allow = Actor.RUN;

  constructor(private readonly inbox: LoginInbox) {
    super();
  }

  input(): null {
    return null;
  }

  async run(work: Work, actor: Actor): Promise<NextLoginView> {
    const space = actor.requireSpace();
    const taken = this.inbox.take(space, actor.id ?? '');
    if (!taken) return new NextLoginView(null);
    const site = await work.row(sites, { id: taken.siteId, space_id: space });
    const form = site ? savedForm(site) : null;
    if (!site || !form) {
      this.inbox.drop(
        space,
        taken.siteId,
        '사이트의 로그인 칸이 바뀌었어요. 화면에서 직접 로그인해 주세요',
      );
      return new NextLoginView(null);
    }
    return new NextLoginView({ site, form, values: taken.values, request: taken.request });
  }
}

type SaveInput = {
  siteId: string;
  outcome: 'submitted' | 'opened' | 'failed';
  reason: string | null;
  afterUrl: string | null;
  image: string | null;
  providerForm: ProviderForm | null;
};

/** MCP browser_login_save: 넣고 누른 결과 (꺼내 간 러너만). 화면은 카드가 10분 동안 본다 (DB에 남기지 않는다) */
export class SaveLogin extends Read<SaveInput> {
  readonly name = 'saveLogin';
  readonly allow = Actor.RUN;

  constructor(private readonly inbox: LoginInbox) {
    super();
  }

  input(raw: unknown): SaveInput {
    return this.fields(raw, (f) => {
      const outcome = f.text('outcome', 20);
      if (outcome !== 'submitted' && outcome !== 'opened' && outcome !== 'failed')
        f.reject('outcome', 'submitted · opened · failed예요');
      return {
        siteId: f.uuid('site_id'),
        outcome: outcome === 'submitted' || outcome === 'opened' ? outcome : 'failed',
        reason: f.optionalText('reason', 300),
        afterUrl: f.optionalText('after_url', 2000),
        image: imageOf(f, 'image', false),
        providerForm: providerFormOf(f),
      };
    });
  }

  async run(_work: Work, actor: Actor, input: SaveInput): Promise<LoginSavedView> {
    if (input.image) decodeImage(input.image); // 그림이 아닌 것은 받지 않는다
    const saved = this.inbox.save(actor.requireSpace(), input.siteId, actor.id ?? '', input);
    if (!saved) throw new RuleViolation('이 러너가 넣는 중인 로그인이 아니에요');
    return new LoginSavedView(input.outcome);
  }
}
