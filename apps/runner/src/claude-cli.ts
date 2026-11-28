import { dirname } from 'node:path';
import { AiProcess } from './ai-process';
import type { AiStream, AiTool } from './ai-tool';
import { BrowserMcp } from './browser-mcp';
import { ClaudeSignin } from './claude-signin';
import { ClaudeStream } from './claude-stream';
import { CliRuntime } from './cli-runtime';
import type { EngineAdapter } from './engine-adapter';
import type { ExternalMcp } from './external-mcp';
import type { Job } from './job';
import { JobWorkspace } from './job-workspace';
import type { LineagePlace } from './lineage-store';
import { MemoHook } from './memo-hook';
import type { PromptPack } from './prompt-pack';
import type { RunnerConfig } from './runner-config';
import type { SandboxRoom } from './sandbox-room';

// Claude Code를 부르는 법. 엔진 어댑터(ClaudeEngine)는 맨 아래에 있다 (리팩토링 E2).
//
// 격리: 설정·홈은 빈 임시 폴더, MCP는 --strict-mcp-config로 넘긴 것만 (cairn, 브라우저 작업의 playwright, 허락한 외부 도구 x-*), claude.ai 연결은 끈다.
// 브라우저 작업(browse)에서만 playwright를 더한다 (BrowserMcp: 서버 브라우저에 CDP로, 사이트의 허용 출처만).
// --bare는 쓰지 않는다: CLAUDE_CODE_OAUTH_TOKEN을 읽지 않는다.
// 권한: 셸을 주지 않는다. 내장 도구는 파일 도구만, 쓰기는 acceptEdits라 work 폴더 안에서만, MCP는 cairn만 묻지 않고 허락한다.
// 예외: 코드 러너 칸의 일(코드 · 만들기)은 셸 · 찾기(Bash · Glob · Grep)를 묻지 않고 허락한다. 칸 안의 agent로 돌고 바깥은 허용 목록뿐이다.
// -p는 물을 사람이 없어서 그 밖의 것은 거절된다. 작업 폴더 밖 읽기도 그렇다: Claude가 허락을 묻고, 답할 사람이 없어 거절된다.
// 그래도 주인의 홈은 settings.json의 deny로 막는다 (ClaudeCli.settings): 거절이 더 확실하고 권한 모드가 바뀌어도 남는다.
// 주인의 컴퓨터나 서버의 러너 컨테이너에서 돌아가므로 AI가 지시문에 속아도 이 안에 머문다.
// 로그인 토큰은 일마다 정해지고 (AiLogins), 파일에 쓰지 않고 환경 변수로만 넘긴다.
export class ClaudeCli implements AiTool {
  static readonly TOOL = 'claude';
  private static readonly FILE_TOOLS = ['Read', 'Write', 'Edit'];
  /** 코드 러너 칸의 일(코드 · 만들기)에만 더한다: 셸과 찾기 */
  private static readonly CODE_TOOLS = ['Bash', 'Glob', 'Grep'];
  private static readonly SKILL_TOOL = 'Skill';
  /**
   * 웹 검색: MCP가 붙는 모든 일에 연다 (2026-11-13). 검색은 Anthropic 쪽에서 돌고 제목 · 주소만 돌려주므로
   * 칸의 나가는 허용 목록과 상관없다. 주소를 직접 여는 WebFetch는 열지 않는다: 주소 읽기는 서버의 read_url이
   * 유출 · 내부망 규칙을 보고 대신 한다 (task 모듈)
   */
  private static readonly WEB_TOOL = 'WebSearch';
  /** 사용자 환경에서 넘기는 것. 나머지(기기 토큰 포함)는 AI CLI에게 가지 않는다 */
  private static readonly PASSED_ENV = [
    'PATH',
    'LANG',
    'LC_ALL',
    'LC_CTYPE',
    'TZ',
    'TMPDIR',
    'SHELL',
    'USER',
    // 코드 러너 칸은 나가는 프록시로만 바깥(모델 API)에 닿는다
    'HTTPS_PROXY',
    'HTTP_PROXY',
    'NO_PROXY',
    'https_proxy',
    'http_proxy',
    'no_proxy',
  ];
  /** 일에 쓰는 모델 계열 (Claude Code의 availableModels). 서버의 위임 모델 고르기(ModelTier.CHOICES)와 같다 */
  private static readonly MODELS: readonly string[] = ['opus', 'sonnet', 'haiku'];

  private static readonly HEADLESS_ENV: Readonly<Record<string, string>> = {
    ENABLE_CLAUDEAI_MCP_SERVERS: 'false',
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL: '1',
    CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1',
  };

  readonly id = ClaudeCli.TOOL;
  /** 이 일에 붙인 브라우저 (어댑터는 일마다 새로 만든다) */
  private browser: BrowserMcp | null = null;
  /** 셸을 여는가: 코드 러너 칸의 자리에서 하는 코드 작업만 */
  private shell = false;
  /** 웹 검색을 여는가: MCP가 붙는 일 (연결 확인은 도구가 없다) */
  private web = false;
  /** 에이전트가 정한 모델 · 생각 강도 (2차 7단계) */
  private runtime = CliRuntime.NONE;
  /** 이 일에 붙인 외부 도구 (2차 7단계). MCP가 붙는 일이고 셸이 없을 때만 */
  private tools: readonly ExternalMcp[] = [];
  /** 세션 파일을 남기는가: 세션 키의 고정 자리에서 도는 일 (2026-11-17) */
  private keep = false;
  /** 재개할 CLI 세션. 새로 시작하면 null */
  private resumeFrom: string | null = null;
  /** 인수인계 메모를 쓰게 하는가 (작업 세션에 기록하는 일): Stop 훅을 단다 */
  private memo = false;
  /** 그 메모 파일 (스트림이 메모 쓰기를 알아본다) */
  private memoFile: string | null = null;
  /** --effort가 받는 값 (Claude Code 2.1의 도움말). 모르는 값은 넘기지 않고 CLI의 기본으로 */
  static readonly EFFORTS: readonly string[] = ['low', 'medium', 'high', 'xhigh', 'max'];

  constructor(
    readonly bin: string,
    private readonly oauthToken: string,
    private readonly mcpUrl: string = '',
    private readonly skillsDir: string = '',
    /** 서버 브라우저의 CDP 주소. 없으면 브라우저 작업에도 붙이지 않는다 */
    private readonly browserUrl: string | null = null,
  ) {}

  /**
   * 작업 자리: work 밖의 mcp.json(작업 토큰), 설정 폴더의 권한 설정과 스킬.
   * place가 있으면 세션 키의 고정 자리에서 세션 파일을 남기고, 러너가 정한 세션(job.lineage.resumeFrom)을 재개한다
   */
  async open(
    job: Job,
    room: SandboxRoom | null = null,
    place: LineagePlace | null = null,
  ): Promise<JobWorkspace> {
    const { runToken } = job;
    this.browser = runToken === null ? null : BrowserMcp.for(job, this.browserUrl);
    this.shell = job.sandboxed && room !== null && runToken !== null;
    this.web = runToken !== null;
    this.runtime = job.runtime;
    this.tools = runToken === null || job.sandboxed ? [] : job.runtime.tools;
    this.memo = runToken !== null && job.lineage !== null;
    this.keep = place !== null;
    this.resumeFrom = place === null ? null : (job.lineage?.resumeFrom ?? null);
    const workspace = await JobWorkspace.open(
      runToken === null
        ? null
        : ClaudeCli.mcpConfig(this.mcpUrl, runToken, this.browser, this.tools),
      ClaudeCli.settings(process.env.HOME, this.memo),
      job.skill,
      this.skillsDir,
      room,
      job.skillPackage,
      place,
      this.memo,
    );
    if (this.memo) await MemoHook.install(workspace.configDir);
    this.memoFile = this.memo ? workspace.memoPath : null;
    return workspace;
  }

  stream(): AiStream {
    return new ClaudeStream(
      [
        ClaudeStream.SERVER,
        ...(this.browser ? [BrowserMcp.SERVER] : []),
        ...this.tools.map((t) => t.server),
      ],
      this.shell,
      this.memoFile,
    );
  }

  /** setup-token의 토큰은 쓰는 동안 바뀌지 않는다 */
  async changedCredential(): Promise<string | null> {
    return null;
  }

  get secrets(): readonly string[] {
    return [this.oauthToken];
  }

  /**
   * mcp.json의 내용. 이 파일에만 작업 토큰 · 외부 도구의 머리글을 쓴다 (작업 자리 밖, 600, 작업이 끝나면 지운다).
   * 브라우저 작업이면 playwright를, 허락한 외부 도구가 있으면 x-<이름>의 원격 MCP를 더한다
   */
  static mcpConfig(
    url: string,
    runToken: string,
    browser: BrowserMcp | null = null,
    tools: readonly ExternalMcp[] = [],
  ): string {
    const servers: Record<string, object> = {
      [ClaudeStream.SERVER]: {
        type: 'http',
        url,
        headers: { Authorization: `Bearer ${runToken}` },
      },
    };
    if (browser)
      servers[BrowserMcp.SERVER] = { type: 'stdio', command: browser.command, args: browser.args };
    for (const tool of tools)
      servers[tool.server] = { type: 'http', url: tool.url, headers: { ...tool.headers } };
    return JSON.stringify({ mcpServers: servers });
  }

  /**
   * config/settings.json의 내용. 지시문에 속아도 ~/.ssh나 러너의 .env를 읽어 초안에 옮기지 못하게 주인의 홈을 막는다.
   * 작업 폴더 밖 읽기는 물어도 답할 사람이 없어 어차피 거절되지만, deny는 묻지도 않고 권한 모드가 바뀌어도 남는다.
   * HOME은 빈 임시 폴더로 바꾸므로 `~`가 아니라 절대 경로로 적는다. 앞의 //가 절대 경로라는 표시다.
   */
  static settings(ownerHome: string | undefined, memoHook = false): string {
    const home = ownerHome?.replace(/\/+$/, '');
    const deny = home ? ClaudeCli.FILE_TOOLS.map((tool) => `${tool}(/${home}/**)`) : [];
    return JSON.stringify({
      permissions: { deny },
      // 쓰는 모델 (2026-11-19, Fable은 쓰지 않음): 서버 · 러너가 먼저 거절하고, 그래도 들어오면 CLI가 허락된 가장 새 모델로 바꾼다
      availableModels: ClaudeCli.MODELS,
      ...(memoHook ? { hooks: MemoHook.settings() } : {}),
    });
  }

  args(workspace: JobWorkspace): readonly string[] {
    // 세션 파일은 세션 키의 고정 자리에서만 남긴다 (재개, 2026-11-17). 그 밖의 일은 남기지 않는다
    const print = [
      '-p',
      '--output-format',
      'stream-json',
      '--verbose',
      ...(this.keep ? [] : ['--no-session-persistence']),
      ...(this.resumeFrom === null ? [] : ['--resume', this.resumeFrom]),
      '--strict-mcp-config',
      ...this.runtimeArgs(),
    ];
    // 연결 확인: MCP도 도구도 없이 답만 받는다. --tools는 값을 여럿 받으므로 맨 뒤에 둔다
    if (!workspace.mcpReady) return [...print, '--tools', ''];
    const tools = [
      ...ClaudeCli.FILE_TOOLS,
      ...(this.shell ? ClaudeCli.CODE_TOOLS : []),
      ...(this.web ? [ClaudeCli.WEB_TOOL] : []),
      ...(workspace.skillReady ? [ClaudeCli.SKILL_TOOL] : []),
    ];
    return [
      ...print,
      '--mcp-config',
      workspace.mcpConfigPath,
      '--tools',
      tools.join(','),
      '--allowedTools',
      `mcp__${ClaudeStream.SERVER}__*`,
      ...(this.browser ? [`mcp__${BrowserMcp.SERVER}__*`] : []),
      ...this.tools.map((t) => `mcp__${t.server}__*`),
      ...(workspace.skillReady ? [ClaudeCli.SKILL_TOOL] : []),
      ...(this.shell ? ClaudeCli.CODE_TOOLS : []),
      ...(this.web ? [ClaudeCli.WEB_TOOL] : []),
      ...(this.browser
        ? [
            '--disallowedTools',
            ...BrowserMcp.BLOCKED_TOOLS.map((t) => `mcp__${BrowserMcp.SERVER}__${t}`),
          ]
        : []),
      // 코드 러너 칸의 결과물 폴더는 저장소(작업 폴더) 밖이라 따로 열어 준다. 값을 여럿 받는 옵션이라 다음 옵션 앞에 둔다
      ...(workspace.outputsStage === null ? [] : ['--add-dir', workspace.outputsDir]),
      ...(workspace.inputsDir === null ? [] : ['--add-dir', workspace.inputsDir]),
      // 칸의 일은 인수인계 메모를 저장소 사본 밖에 둔다 (그 밖의 일은 작업 폴더 안이라 따로 열지 않는다)
      ...(workspace.memoPath === null || workspace.outputsStage === null
        ? []
        : ['--add-dir', dirname(workspace.memoPath)]),
      '--permission-mode',
      'acceptEdits',
    ];
  }

  /** 모델 · 생각 강도. 비었으면 CLI의 기본이라 넘기지 않는다 */
  private runtimeArgs(): readonly string[] {
    const { model, effort } = this.runtime;
    return [
      ...(model === '' ? [] : ['--model', model]),
      ...(ClaudeCli.EFFORTS.includes(effort) ? ['--effort', effort] : []),
    ];
  }

  /** memoReason: 메모가 비었을 때 Stop 훅이 막는 까닭 (지시문 틀 memo-stop). 메모를 쓰지 않는 일은 null */
  env(
    workspace: JobWorkspace,
    parent: Readonly<Record<string, string | undefined>>,
    memoReason: string | null = null,
  ): Readonly<Record<string, string>> {
    const memo = workspace.memoPath;
    const passed = ClaudeCli.PASSED_ENV.flatMap((name) => {
      const value = parent[name];
      return value === undefined ? [] : [[name, value] as const];
    });
    return {
      ...Object.fromEntries(passed),
      ...ClaudeCli.HEADLESS_ENV,
      HOME: workspace.homeDir,
      ...(workspace.tmpDir === null ? {} : { TMPDIR: workspace.tmpDir }),
      CLAUDE_CONFIG_DIR: workspace.configDir,
      CLAUDE_CODE_OAUTH_TOKEN: this.oauthToken,
      ...(memo === null || memoReason === null
        ? {}
        : { [MemoHook.FILE_ENV]: memo, [MemoHook.REASON_ENV]: memoReason }),
    };
  }

  start(
    job: Job,
    workspace: JobWorkspace,
    prompts: PromptPack,
    onLine: (line: string) => void,
  ): AiProcess {
    const memo = workspace.memoPath;
    const reason = memo === null ? null : prompts.fill('memo-stop', { path: memo });
    return new AiProcess(
      this.bin,
      this.args(workspace),
      workspace.workDir,
      this.env(workspace, process.env, reason),
      job.prompt(prompts, workspace.skillReady, null, workspace.outputsDir, memo),
      onLine,
      workspace.user,
    );
  }
}

/** 엔진 claude (engines.json). 실행은 ClaudeCli, 웹 로그인은 ClaudeSignin. 환경 변수의 토큰(setup-token)을 러너가 스스로 가질 수 있다 */
export class ClaudeEngine implements EngineAdapter {
  readonly name = ClaudeCli.TOOL;
  readonly efforts = ClaudeCli.EFFORTS;
  readonly bin = { env: 'CAIRN_RUNNER_CLI', fallback: 'claude' };
  readonly ownLogin = 'CLAUDE_CODE_OAUTH_TOKEN';
  readonly resumes = true;
  /** 작업 폴더의 photos/에 받은 사진을 Read로 본다 (그림 파일을 읽으면 그림으로 받는다) */
  readonly photos = 'read';
  readonly signin = new ClaudeSignin();

  tool(credential: string, config: RunnerConfig): AiTool {
    return new ClaudeCli(
      config.binOf(this),
      credential,
      config.mcpUrl,
      config.skillsDir,
      config.browserUrl,
    );
  }
}
