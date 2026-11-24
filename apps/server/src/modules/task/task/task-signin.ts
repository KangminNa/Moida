import { Conflict, RuleViolation } from '../../platform';
import { Engines } from '../ai/engines';

type Payload = Readonly<Record<string, unknown>>;

// 웹 AI 로그인 일(ai_signin)의 입력(payload) 규칙. 러너가 로그인 명령을 대신 돌리고, 로그인 주소와
// 사람이 붙여 넣은 코드(암호화한 값)가 payload로 오간다. 단계(step): starting → open_url(기기 코드 엔진) · waiting_code → verifying.
// 상태(작업이 도는 중인지)는 Task가 보고, 여기서는 payload의 다음 모습만 정한다 (null이면 그대로 둔다).
// biome-ignore lint/complexity/noStaticOnlyClass: 상태 없는 판단 한 곳 (TurnDeliver와 같은 방식)
export class TaskSignin {
  static readonly STARTING = 'starting';
  static readonly OPEN_URL = 'open_url';
  static readonly WAITING_CODE = 'waiting_code';
  static readonly VERIFYING = 'verifying';

  /** 새 웹 로그인의 입력 */
  static start(tool: string): Payload {
    return { tool, step: TaskSignin.STARTING };
  }

  static toolOf(payload: Payload): string {
    return String(payload.tool);
  }

  /**
   * 사람이 붙여 넣은 코드 (암호화한 값). 로그인이 끝날 때까지 물을 때마다 같은 것을 준다:
   * 응답을 잃어도 러너가 다시 받을 수 있게. 러너는 한 번만 쳐 넣는다. 끝나면 지운다 (forgotten)
   */
  static codeOf(payload: Payload): string | null {
    return typeof payload.code === 'string' ? payload.code : null;
  }

  /** 작업 상세에 보일 payload: 웹 로그인(ai_signin)이면 코드를 뺀다 (Task에서 옮김, 2026-11-24) */
  static shownOf(kind: string, payload: unknown): unknown {
    return kind === 'ai_signin' ? TaskSignin.shown(payload) : payload;
  }

  /** 작업 상세에 보일 payload. 코드는 암호문이어도 내보내지 않는다 */
  static shown(payload: unknown): unknown {
    if (typeof payload !== 'object' || payload === null) return payload;
    const { code: _sealed, ...rest } = payload as Record<string, unknown>;
    return rest;
  }

  /**
   * 러너가 로그인 주소를 찾았다. 코드를 붙여 넣는 엔진(Claude)은 이제 사람이 브라우저의 코드를 붙여 넣을 차례고,
   * 기기 코드 엔진(Codex)은 사람이 주소에서 코드를 입력하면 CLI가 스스로 끝난다 (엔진 목록의 login.flow).
   * 주소는 한 번만 정한다. 러너가 같은 것을 다시 보내면(응답을 못 받은 재시도) null
   */
  static withUrl(payload: Payload, url: string, userCode: string | null): Payload | null {
    if (payload.step !== TaskSignin.STARTING) {
      if (payload.url === url && (payload.userCode ?? null) === userCode) return null;
      throw new Conflict('이미 로그인 주소를 알렸어요');
    }
    const step = Engines.of(TaskSignin.toolOf(payload)).login.pastesCode
      ? TaskSignin.WAITING_CODE
      : TaskSignin.OPEN_URL;
    return { ...payload, url, userCode, step };
  }

  /** 사람이 붙여 넣은 코드를 받는다 (암호화한 값). 러너가 가져갈 때까지만 둔다 */
  static withCode(payload: Payload, sealedCode: string): Payload {
    if (payload.step !== TaskSignin.WAITING_CODE)
      throw new RuleViolation('코드를 붙여 넣을 차례가 아니에요');
    return { ...payload, code: sealedCode, step: TaskSignin.VERIFYING };
  }

  /** 다시 빌렸다 (앞 러너가 사라짐): 앞 시도의 주소와 코드는 쓸모가 없다. 이미 처음이면 null */
  static restarted(payload: Payload): Payload | null {
    return payload.step === TaskSignin.STARTING
      ? null
      : TaskSignin.start(TaskSignin.toolOf(payload));
  }

  /** 끝나거나 대기열로 돌아간 웹 로그인에는 주소도 코드도 남기지 않는다. 어느 도구였는지만. 이미 그렇다면 null */
  static forgotten(payload: Payload): Payload | null {
    return Object.keys(payload).some((key) => key !== 'tool') ? { tool: payload.tool } : null;
  }
}
