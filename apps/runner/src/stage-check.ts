import type { StepOutput } from './agent-user';
import type { Job } from './job';
import { Clip } from './progress';
import type { PromptPack } from './prompt-pack';
import type { Redactor } from './redactor';

// 하네스의 검사 하나 (검증 고리 V). AI CLI가 잘 끝난 뒤 칸의 단계가 돌린다 (SandboxStage.check):
// 코드 작업은 검사 명령(checks), 만들기 작업은 outputs 폴더의 파일.
// 떨어지면 JobRun이 같은 작업 폴더에서 AI에게 한 번 더 맡기고(틀 check-fix) 다시 검사한 뒤 끝낸다.
// 결과(submit_result)의 result.checks로 서버에 가고, 결과 카드가 항목 옆에 보인다.
export class StageCheck {
  /** 출력의 끝부분: 마지막 60줄, 4,000자까지 */
  private static readonly TAIL_LINES = 60;
  private static readonly TAIL_MAX = 4_000;
  /** 서버가 받는 result.checks 한도 (SubmitResultInput) */
  private static readonly NAME_MAX = 200;
  private static readonly HOW_MAX = 80;
  private static readonly SENT_MAX = 20;
  /** 다시 맡길 때 AI에게 보이는 앞 실행의 마지막 답 */
  private static readonly SUMMARY_MAX = 2_000;

  private constructor(
    /** 검사 이름 (코드 작업은 명령 그대로) */
    readonly name: string,
    readonly ok: boolean,
    /** 끝난 모습 (통과 · 코드 1 · 시간 초과 · 없음 …) */
    readonly how: string,
    /** 출력의 끝부분. 토큰을 지운 뒤다 (AI에게 다시 보이고 결과 글 · PR 본문에 싣는다) */
    readonly tail: string,
    /** AI에게 한 번 더 고치게 한 뒤의 검사인가 */
    readonly retried = false,
  ) {}

  /** 러너가 직접 본 것 (출력이 아니라 러너가 쓴 글이라 지울 것이 없다). why: 떨어졌을 때만 AI에게 보일 까닭 */
  static seen(name: string, ok: boolean, how: string, why: string): StageCheck {
    return new StageCheck(name, ok, how, ok ? '' : why);
  }

  /** agent로 돌린 검사 명령 하나의 끝. 토큰을 먼저 지우고 자른다: 자른 뒤에는 토큰 일부가 남을 수 있다 */
  static ofStep(command: string, out: StepOutput, redactor: Redactor): StageCheck {
    const lines = redactor.clean(out.tail).trim().split('\n');
    const tail = lines.slice(-StageCheck.TAIL_LINES).join('\n').slice(-StageCheck.TAIL_MAX);
    return new StageCheck(command, out.ok, out.how, tail);
  }

  /** AI에게 한 번 더 맡긴 뒤의 검사로 */
  asRetried(): StageCheck {
    return new StageCheck(this.name, this.ok, this.how, this.tail, true);
  }

  /** submit_result의 result.checks 항목. 이름 · 끝난 모습은 서버의 한도로 자른다 */
  toJSON(): object {
    return {
      name: Clip.text(this.name, StageCheck.NAME_MAX) || '(이름 없음)',
      ok: this.ok,
      how: Clip.text(this.how, StageCheck.HOW_MAX) || '(모름)',
      retried: this.retried,
    };
  }

  /** 결과에 더할 칸 (RunResult.with). 검사가 없으면 빈 칸 */
  static resultOf(checks: readonly StageCheck[]): Readonly<Record<string, unknown>> {
    return checks.length === 0 ? {} : { checks: checks.slice(0, StageCheck.SENT_MAX) };
  }

  /**
   * 검사에 떨어져 AI에게 한 번 더 줄 일 (틀 check-fix): 지시만 바꾸고 단락 · 작업 폴더 · 작업 토큰은 그대로.
   * summary: 앞 실행의 마지막 답
   */
  static retryJob(
    job: Job,
    prompts: PromptPack,
    summary: string,
    checks: readonly StageCheck[],
  ): Job {
    const brief = summary.trim().slice(0, StageCheck.SUMMARY_MAX);
    const failures = checks.filter((c) => !c.ok).map((c) => c.failure());
    return job.withInstruction(
      prompts.fill('check-fix', {
        title: job.title,
        instruction: job.instruction,
        summary: brief || null,
        failures: failures.join('\n\n'),
      }),
    );
  }

  /** 떨어진 검사 하나: 이름과 끝난 모습, 출력의 끝부분 (출력 속의 ```에 닫히지 않게 더 긴 울타리로) */
  private failure(): string {
    const body = this.tail || '(출력 없음)';
    const longest = Math.max(0, ...[...body.matchAll(/`+/g)].map((m) => m[0].length));
    const fence = '`'.repeat(Math.max(3, longest + 1));
    return `- ${this.name}: ${this.how}\n${fence}\n${body}\n${fence}`;
  }
}
