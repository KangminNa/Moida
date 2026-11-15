import { RuleViolation } from '../../platform';
import ENGINES from '../engines.json';
import type { AgentTool } from '../task.tables';
import { EngineView } from './ai-login.view';

// 엔진 목록 한 파일 (리팩토링 E1, task/engines.json): 일하는 구독 CLI마다 이름 · 생각 강도 · 모델 · 사용률 창 · 로그인.
// CLI 이름을 코드에 쓰지 않고 여기서 묻는다: 강도 확인(AgentRuntime), 고르는 순서(LeasePolicy · 에이전트 기본값),
// 로그인의 모양(주소 · 코드 · 자격)과 흐름(코드 붙여 넣기 · 기기 코드), 자격의 기간 · 갱신 토큰이 바뀌는지.
// 이름이 DB 값 목록과 같은지는 engines.test가 본다. 러너 쪽(실행 · 출력 · 로그인 명령)은 러너 어댑터가 안다 (E2).

/** engines.json의 로그인 한 줄 */
interface LoginSpec {
  readonly flow: string;
  readonly urls: readonly string[];
  readonly query: boolean;
  readonly userCode: string | null;
  readonly leak: string | null;
  readonly credential: {
    readonly kind: string;
    readonly prefix?: string;
    readonly pattern?: string;
    readonly maxBytes?: number;
    readonly label: string;
  };
  readonly termYears: number | null;
  readonly rotating: boolean;
}

/** engines.json의 엔진 한 줄 */
interface EngineSpec {
  readonly label: string;
  readonly efforts: readonly string[];
  readonly models: readonly (readonly [string, string])[] | null;
  readonly windows: readonly string[];
  readonly login: LoginSpec;
}

/**
 * 엔진의 로그인 (웹 로그인 · 직접 넣는 토큰 · 되돌려 쓰는 자격). 러너가 알리는 주소 · 코드 · 자격은 믿지 않는 입력이라
 * 정해진 모양일 때만 받는다
 */
export class EngineLogin {
  static readonly PASTE_CODE = 'paste_code';
  static readonly DEVICE_CODE = 'device_code';
  private static readonly TOKEN = 'token';
  /** 사람이 브라우저에서 붙여 넣는 코드: 공백 없는 보이는 글자 */
  private static readonly BROWSER_CODE = /^[\x21-\x7E]{4,1024}$/;

  constructor(private readonly spec: LoginSpec) {}

  get flow(): string {
    return this.spec.flow;
  }

  /** 사람이 브라우저에 나온 코드를 붙여 넣는 로그인인가 (아니면 사람이 주소에서 코드를 입력하고 CLI가 스스로 끝난다) */
  get pastesCode(): boolean {
    return this.spec.flow === EngineLogin.PASTE_CODE;
  }

  /** 관리자가 토큰을 직접 넣을 수 있는가 (자격이 토큰 한 줄) */
  get takesToken(): boolean {
    return this.spec.credential.kind === EngineLogin.TOKEN;
  }

  /** 직접 넣는 토큰의 앞부분 (없으면 null): 입력의 모양 검사가 쓴다 */
  get tokenPrefix(): string | null {
    return this.spec.credential.prefix ?? null;
  }

  /** 쓸 때마다 갱신 토큰이 바뀌는 자격인가 (러너가 실행 뒤 되돌려 쓰고, 서버의 로그인으로는 한 번에 하나만 돈다) */
  get rotating(): boolean {
    return this.spec.rotating;
  }

  /** 자격의 만료: 정해진 기간이면 저장한 날부터 (CLI가 남은 기간을 알려 주지 않는다), 스스로 갱신하면 null */
  termFrom(now: Date): Date | null {
    if (this.spec.termYears === null) return null;
    const end = new Date(now);
    end.setUTCFullYear(end.getUTCFullYear() + this.spec.termYears);
    return end;
  }

  /** 관리자에게 보여 줄 로그인 주소. 정해진 출처 · 경로만, 사용자 정보 · 포트 · 조각 없이 */
  assertUrl(url: string): void {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new RuleViolation('로그인 주소의 모양이 아니에요');
    }
    const base = `${parsed.origin}${parsed.pathname}`;
    const plain = !parsed.username && !parsed.password && !parsed.port && !parsed.hash;
    const known = this.spec.urls.includes(base) && (this.spec.query || !parsed.search);
    const leaks = this.spec.leak !== null && url.toLowerCase().includes(this.spec.leak);
    if (!plain || !known || leaks) throw new RuleViolation('알 수 없는 로그인 주소예요');
  }

  /** 화면의 한 번 쓰는 코드: 기기 코드 흐름은 꼭 있고, 그 밖에는 없다 */
  assertUserCode(userCode: string | null): void {
    const pattern = this.spec.userCode;
    const ok =
      pattern === null
        ? userCode === null
        : userCode !== null && new RegExp(pattern).test(userCode);
    if (!ok) throw new RuleViolation('로그인 코드의 모양이 아니에요');
  }

  /** 저장할 자격: 토큰은 정해진 모양, JSON은 크기 안의 객체 */
  assertCredential(credential: string): void {
    const { kind, pattern, maxBytes, label } = this.spec.credential;
    if (kind === EngineLogin.TOKEN) {
      if (!pattern || !new RegExp(pattern).test(credential))
        throw new RuleViolation(`${label} 모양이 아니에요`);
      return;
    }
    if (credential.length > (maxBytes ?? 0)) throw new RuleViolation(`${label}이 너무 커요`);
    let parsed: unknown;
    try {
      parsed = JSON.parse(credential);
    } catch {
      throw new RuleViolation(`${label}의 모양이 아니에요`);
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
      throw new RuleViolation(`${label}의 모양이 아니에요`);
  }

  /** 사람이 붙여 넣은 브라우저 코드 (엔진과 상관없이 같은 모양) */
  static assertBrowserCode(code: string): void {
    if (!EngineLogin.BROWSER_CODE.test(code))
      throw new RuleViolation('공백 없이 브라우저에 나온 코드를 그대로 붙여 넣어 주세요');
  }
}

/** 일하는 구독 CLI 하나 */
export class Engine {
  readonly login: EngineLogin;

  constructor(
    readonly name: AgentTool,
    private readonly spec: EngineSpec,
  ) {
    this.login = new EngineLogin(spec.login);
  }

  get efforts(): readonly string[] {
    return this.spec.efforts;
  }

  /** 이 엔진이 이 생각 강도를 받는가 (빈 글은 CLI의 기본이라 늘 받는다). 아니면 RuleViolation */
  assertEffort(effort: string): void {
    if (effort !== '' && !this.spec.efforts.includes(effort))
      throw new RuleViolation(`${this.name}의 생각 강도는 ${this.spec.efforts.join(' · ')}만 돼요`);
  }

  view(): EngineView {
    const s = this.spec;
    return new EngineView(
      this.name,
      s.label,
      s.efforts,
      s.models,
      s.windows,
      s.login.flow,
      this.login.takesToken,
    );
  }
}

// biome-ignore lint/complexity/noStaticOnlyClass: 엔진 목록을 한 파일에서 읽는 한 곳
export class Engines {
  private static readonly ALL: readonly Engine[] = Object.entries(
    ENGINES.engines as unknown as Readonly<Record<string, EngineSpec>>,
  ).map(([name, spec]) => new Engine(name as AgentTool, spec));

  /** 파일 순서 = 고르는 순서 */
  static list(): readonly Engine[] {
    return Engines.ALL;
  }

  static names(): readonly AgentTool[] {
    return Engines.ALL.map((e) => e.name);
  }

  /** 기본 엔진 (첫 줄): 새 에이전트, 에이전트 없는 일을 돌릴 서버의 로그인을 고를 때 먼저 */
  static preferred(): AgentTool {
    return Engines.ALL[0]?.name ?? ('' as AgentTool);
  }

  /** 갱신 토큰이 바뀌는 자격의 엔진들 */
  static rotating(): readonly string[] {
    return Engines.ALL.filter((e) => e.login.rotating).map((e) => e.name);
  }

  /** 이름으로 엔진. 목록에 없으면 null (입력의 모양 검사가 쓴다) */
  static find(name: string): Engine | null {
    return Engines.ALL.find((e) => e.name === name) ?? null;
  }

  /** 이름으로 엔진. 목록에 없으면 RuleViolation */
  static of(name: string): Engine {
    const engine = Engines.find(name);
    if (!engine) throw new RuleViolation(`AI 도구는 ${Engines.names().join(' · ')} 중 하나예요`);
    return engine;
  }
}
