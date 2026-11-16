import type { ChildExit } from './ai-process';
import type { AiTool } from './ai-tool';
import { ClaudeEngine } from './claude-cli';
import { CodexEngine } from './codex-cli';
import type { RunnerConfig } from './runner-config';

/** 로그인 명령의 화면에서 꺼낸 것: 주인에게 보일 주소와 (있으면) 한 번 쓰는 코드 */
export interface SigninPrompt {
  readonly url: string;
  readonly userCode: string | null;
}

/**
 * 엔진 하나의 웹 로그인 (SigninRun이 공통 단계를 돌리고 엔진만의 것을 묻는다).
 * 화면은 비밀이다: 정해진 모양의 값만 꺼내고, 화면의 글은 어디에도 보내거나 적지 않는다.
 */
export interface EngineSignin {
  /** engines.json의 login.flow. paste_code: 주인이 받은 코드를 붙여 넣는다, device_code: 주인이 주소에서 코드를 넣는다 */
  readonly flow: 'paste_code' | 'device_code';
  /** 로그인 명령의 인자 */
  readonly args: readonly string[];
  /** 로그인 명령을 띄우기 전에 빈 설정 폴더에 쓸 것 */
  prepare(configDir: string): Promise<void>;
  /** 설정 폴더를 알리는 환경 변수 */
  env(configDir: string): Readonly<Record<string, string>>;
  /** 끝까지 그려진 주소(와 코드). 아직이면 null */
  read(screenText: string): SigninPrompt | null;
  /** 받은 자격. 아직 없으면 null. exitedOk: 명령이 코드 0으로 끝났다 */
  credential(screenText: string, configDir: string, exitedOk: boolean): Promise<string | null>;
  /** 이 엔진만의 실패 문구. 없으면 null (공통 문구). how: "코드 1" · "신호 SIGTERM" */
  failure(exit: ChildExit, typed: boolean, how: string): string | null;
}

/**
 * 러너가 일할 줄 아는 구독 CLI 하나 (리팩토링 E2). 이름 · 강도 · 로그인 방식은 서버의 엔진 목록
 * (apps/server/src/modules/task/engines.json)과 같다 (engine-adapter.test). 러너의 공통 코드는 이름을 보지 않고 어댑터에 묻는다.
 */
export interface EngineAdapter {
  /** engines.json의 이름 */
  readonly name: string;
  /** CLI가 받는 생각 강도. 모르는 값은 넘기지 않고 CLI의 기본으로 */
  readonly efforts: readonly string[];
  /** 실행 파일 경로를 주는 환경 변수와 기본값 */
  readonly bin: { readonly env: string; readonly fallback: string };
  /** 러너가 스스로 가질 수 있는 로그인의 환경 변수. 없으면 null */
  readonly ownLogin: string | null;
  /** 일의 자격으로 실행 어댑터를 만든다 (일마다 새로) */
  tool(credential: string, config: RunnerConfig): AiTool;
  readonly signin: EngineSignin;
}

// biome-ignore lint/complexity/noStaticOnlyClass: 엔진 이름에서 어댑터를 고르는 한 곳
export class EngineAdapters {
  /** engines.json과 같은 순서 */
  private static readonly ALL: readonly EngineAdapter[] = [new ClaudeEngine(), new CodexEngine()];

  /** 모르는 엔진이면 null */
  static of(name: string): EngineAdapter | null {
    return EngineAdapters.ALL.find((engine) => engine.name === name) ?? null;
  }

  static names(): readonly string[] {
    return EngineAdapters.ALL.map((engine) => engine.name);
  }

  static list(): readonly EngineAdapter[] {
    return EngineAdapters.ALL;
  }
}
