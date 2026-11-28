import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { StepOutput } from './agent-user';
import { Job } from './job';
import { Json } from './json';
import { Redactor } from './redactor';
import { StageCheck } from './stage-check';
import { REPO_PROMPTS } from './testing/repo-prompts';

// 하네스의 검사 (검증 고리 V): 출력의 끝부분, 서버로 가는 모양, 떨어졌을 때 AI에게 한 번 더 줄 일.

const SECRET = 'ghs_secret-token-123456';
const redactor = new Redactor([SECRET]);
const step = (code: number | null, tail: string, spawnError: string | null = null) =>
  new StepOutput(code, null, false, false, tail, null, spawnError);

const codeJob = () =>
  Job.from(
    Json.parse(
      JSON.stringify({
        task: {
          id: '00000000-0000-7000-8000-000000000001',
          kind: 'code',
          title: '로그인 고치기',
          payload: { code: {} },
        },
        agent: { name: '코드 담당', role: '고친다', tool: 'claude' },
        instruction: '로그인이 깨졌어요 [표시]',
        run_token: 'moida_run_x',
      }),
    ) as Json,
  ).withBrief('# 저장소\n시험 저장소');

describe('하네스의 검사', () => {
  test('출력의 끝부분은 토큰을 지운 뒤 마지막 60줄 · 4,000자까지', () => {
    const many = Array.from({ length: 100 }, (_, i) => `줄 ${i} ${SECRET}`).join('\n');
    const failed = StageCheck.ofStep('npm test', step(1, `${many}\n\n`), redactor);
    const lines = failed.tail.split('\n');
    assert.equal(lines.length, 60);
    assert.equal(lines[0], '줄 40 [지움: 토큰]');
    assert.equal(failed.tail.includes(SECRET), false);
    assert.deepEqual([failed.ok, failed.how, failed.retried], [false, '코드 1', false]);
    const wide = StageCheck.ofStep('x', step(1, 'a'.repeat(5_000)), redactor);
    assert.equal(wide.tail.length, 4_000);
    assert.equal(StageCheck.ofStep('x', step(0, ''), redactor).ok, true);
  });

  test('result.checks는 서버의 모양과 한도대로: 이름 200자 · 끝난 모습 80자 · 20개까지', () => {
    assert.deepEqual(StageCheck.resultOf([]), {}, '검사가 없으면 칸도 없다');
    const long = StageCheck.ofStep('n'.repeat(500), step(null, '', 'e'.repeat(200)), redactor);
    const checks = Array.from({ length: 25 }, () => long);
    const sent = JSON.parse(JSON.stringify(StageCheck.resultOf(checks))) as {
      checks: { name: string; ok: boolean; how: string; retried: boolean }[];
    };
    assert.equal(sent.checks.length, 20);
    const [first] = sent.checks;
    assert.deepEqual(Object.keys(first ?? {}).sort(), ['how', 'name', 'ok', 'retried']);
    assert.equal(first?.name.length, 200);
    assert.equal(first?.how.length, 80);
    assert.equal(first?.ok, false);
    const again = StageCheck.ofStep('npm test', step(0, '통과'), redactor).asRetried();
    assert.deepEqual(JSON.parse(JSON.stringify(again)), {
      name: 'npm test',
      ok: true,
      how: '통과',
      retried: true,
    });
  });

  test('러너가 본 검사는 떨어졌을 때만 까닭을 싣는다', () => {
    assert.equal(StageCheck.seen('결과물 파일', true, '2개', '없어요').tail, '');
    assert.equal(StageCheck.seen('결과물 파일', false, '없음', '없어요').tail, '없어요');
  });

  test('떨어지면 지시만 check-fix로 바꾼 같은 일: 처음 지시 · 앞 답 · 떨어진 검사의 끝부분', () => {
    const job = codeJob();
    const checks = [
      StageCheck.ofStep('test -f src/a.ts', step(0, ''), redactor),
      StageCheck.ofStep(
        'npm test',
        step(1, `실패: 기대 1\n\`\`\`js\nx\n\`\`\`\n${SECRET}`),
        redactor,
      ),
      StageCheck.ofStep('npm run lint', step(2, ''), redactor),
    ];
    const fix = StageCheck.retryJob(
      job,
      REPO_PROMPTS,
      `  고쳤어요\n${'요약'.repeat(2_000)}  `,
      checks,
    );
    assert.equal(fix.runToken, job.runToken, '작업 토큰은 그대로');
    assert.equal(fix.brief, job.brief, '단계의 단락은 그대로');
    assert.equal(fix.title, job.title);
    const text = fix.instruction;
    assert.match(text, /^# 검사에 떨어졌어요: 로그인 고치기/);
    assert.match(text, /## 지시 \(처음과 같음\)\n로그인이 깨졌어요 \[표시\]/);
    assert.match(text, /## 앞 실행의 마지막 답\n고쳤어요\n요약/);
    const summary = /## 앞 실행의 마지막 답\n([\s\S]*?)\n## 떨어진 검사/.exec(text)?.[1] ?? '';
    assert.equal(summary.length, 2_000, '앞 답은 2,000자까지');
    assert.match(
      text,
      /- npm test: 코드 1\n````\n실패: 기대 1\n```js\nx\n```\n\[지움: 토큰\]\n````/,
    );
    assert.match(text, /- npm run lint: 코드 2\n```\n\(출력 없음\)\n```/);
    assert.doesNotMatch(text, /test -f src\/a\.ts/, '통과한 검사는 싣지 않는다');
    const prompt = fix.prompt(REPO_PROMPTS, false);
    assert.match(prompt, /# 할 일: 로그인 고치기\n# 검사에 떨어졌어요/);
    assert.match(prompt, /# 저장소\n시험 저장소/);

    const quiet = StageCheck.retryJob(job, REPO_PROMPTS, '   ', checks).instruction;
    assert.doesNotMatch(quiet, /앞 실행의 마지막 답/, '답이 없으면 그 단락을 뺀다');
  });
});
