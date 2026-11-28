import assert from 'node:assert/strict';
import { realpathSync } from 'node:fs';
import { homedir, tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { ConfigProblem, RunnerConfig } from './runner-config';

const env = {
  MOIDA_RUNNER_URL: 'https://blog.example/',
  MOIDA_RUNNER_TOKEN: 'device-secret',
  CLAUDE_CODE_OAUTH_TOKEN: 'claude-secret',
};

describe('러너 설정', () => {
  test('주소의 끝 슬래시를 떼고 기본값을 채운다', () => {
    const config = RunnerConfig.fromEnv(env);
    assert.equal(config.mcpUrl, 'https://blog.example/mcp');
    assert.deepEqual(config.bins, { claude: 'claude', codex: 'codex' });
    assert.ok(config.skillsDir.endsWith('/skills'));
  });

  test('CLI 경로와 스킬 폴더를 바꿀 수 있다', () => {
    const config = RunnerConfig.fromEnv({
      ...env,
      MOIDA_RUNNER_CLI: '/opt/claude',
      MOIDA_RUNNER_CODEX_CLI: ' /opt/codex ',
      MOIDA_SKILLS_DIR: '/opt/skills',
    });
    assert.deepEqual(config.bins, { claude: '/opt/claude', codex: '/opt/codex' });
    assert.equal(config.skillsDir, '/opt/skills');
  });

  test('세션 키 폴더: 기본은 홈 밖(임시 폴더), MOIDA_RUNNER_LINEAGES_DIR로 바꾸고 상대 경로 · /는 막는다', () => {
    // 홈 아래면 Claude의 홈 막기(deny)에 작업 폴더가 함께 막힌다 (2026-11-19)
    const fallback = RunnerConfig.fromEnv(env).lineagesDir;
    assert.equal(fallback, join(realpathSync(tmpdir()), `moida-runner-lineages-${userInfo().uid}`));
    assert.equal(fallback.startsWith(`${homedir()}/`), false);
    const moved = { ...env, MOIDA_RUNNER_LINEAGES_DIR: ' /tmp/moida-runner/lineages/ ' };
    assert.equal(RunnerConfig.fromEnv(moved).lineagesDir, '/tmp/moida-runner/lineages');
    assert.equal(
      RunnerConfig.fromEnv(moved).withToken('t').lineagesDir,
      '/tmp/moida-runner/lineages',
    );
    for (const bad of ['lineages', '/'])
      assert.throws(
        () => RunnerConfig.fromEnv({ ...env, MOIDA_RUNNER_LINEAGES_DIR: bad }),
        ConfigProblem,
      );
  });

  test('빠진 설정의 이름을 모두 알리고 값은 드러내지 않는다', () => {
    assert.throws(
      () => RunnerConfig.fromEnv({ MOIDA_RUNNER_TOKEN: 'device-secret' }),
      (error: Error) =>
        error instanceof ConfigProblem &&
        error.message.includes('MOIDA_RUNNER_URL') &&
        !error.message.includes('device-secret'),
    );
    assert.throws(
      () => RunnerConfig.fromEnv({ MOIDA_RUNNER_URL: env.MOIDA_RUNNER_URL }),
      /MOIDA_RUNNER_TOKEN/,
    );
  });

  test('Claude 토큰은 없어도 된다: 콘솔에 넣은 토큰을 서버에서 받는다', () => {
    const { CLAUDE_CODE_OAUTH_TOKEN: _, ...rest } = env;
    assert.deepEqual(RunnerConfig.fromEnv(rest).ownLogins, {});
    assert.deepEqual(
      RunnerConfig.fromEnv({ ...rest, CLAUDE_CODE_OAUTH_TOKEN: '  ' }).ownLogins,
      {},
    );
    assert.deepEqual(RunnerConfig.fromEnv(env).ownLogins, { claude: 'claude-secret' });
  });

  test('공백뿐인 값은 없는 것과 같다', () => {
    assert.throws(() => RunnerConfig.fromEnv({ ...env, MOIDA_RUNNER_TOKEN: '  ' }), ConfigProblem);
  });

  test('브라우저(CDP 주소)는 없어도 되고, 있으면 끝 슬래시를 뗀다. 주소가 아니면 시작하지 않는다', () => {
    assert.equal(RunnerConfig.fromEnv(env).browserUrl, null);
    assert.equal(RunnerConfig.fromEnv({ ...env, MOIDA_BROWSER_URL: '  ' }).browserUrl, null);
    const config = RunnerConfig.fromEnv({ ...env, MOIDA_BROWSER_URL: 'http://127.0.0.1:9222/' });
    assert.equal(config.browserUrl, 'http://127.0.0.1:9222');
    assert.equal(config.withToken('other').browserUrl, 'http://127.0.0.1:9222');
    assert.throws(
      () => RunnerConfig.fromEnv({ ...env, MOIDA_BROWSER_URL: 'ws://127.0.0.1:9222' }),
      (error: Error) => error instanceof ConfigProblem && /MOIDA_BROWSER_URL/.test(error.message),
    );
  });

  test('http(s) 주소가 아니면 시작하지 않는다', () => {
    for (const url of ['blog.example', 'ftp://blog.example', 'https://'])
      assert.throws(() => RunnerConfig.fromEnv({ ...env, MOIDA_RUNNER_URL: url }), ConfigProblem);
  });

  test('서버 러너는 토큰 대신 연결 값 파일로 시작한다. 토큰이 있으면 파일은 쓰지 않는다', () => {
    const { MOIDA_RUNNER_TOKEN: _token, ...rest } = env;
    const paired = RunnerConfig.fromEnv({
      ...rest,
      MOIDA_RUNNER_PAIRING_FILE: '/run/moida/pairing',
    });
    assert.equal(paired.deviceToken, null);
    assert.equal(paired.pairingFile, '/run/moida/pairing');
    assert.equal(paired.withToken('got').deviceToken, 'got');
    assert.equal(paired.withToken('got').pairingFile, '/run/moida/pairing');

    const both = RunnerConfig.fromEnv({ ...env, MOIDA_RUNNER_PAIRING_FILE: '/run/moida/pairing' });
    assert.equal(both.deviceToken, 'device-secret');
    assert.equal(both.pairingFile, null, '사람이 넣은 토큰이 먼저');
  });

  test('동시에 하는 일: 서버 러너는 3, 내 컴퓨터 러너는 1이 기본. 1~8만 받고, 코드 러너 칸은 늘 1', () => {
    const { MOIDA_RUNNER_TOKEN: _token, ...rest } = env;
    const server = { ...rest, MOIDA_RUNNER_PAIRING_FILE: '/run/moida/pairing' };
    assert.equal(RunnerConfig.fromEnv(env).concurrency, 1);
    assert.equal(RunnerConfig.fromEnv(server).concurrency, 3);
    assert.equal(RunnerConfig.fromEnv(server).withToken('got').concurrency, 3);
    assert.equal(RunnerConfig.fromEnv({ ...env, MOIDA_RUNNER_CONCURRENCY: ' 8 ' }).concurrency, 8);
    assert.equal(RunnerConfig.fromEnv({ ...server, MOIDA_RUNNER_CONCURRENCY: '1' }).concurrency, 1);
    for (const bad of ['0', '9', '2.5', '-1', 'two'])
      assert.throws(
        () => RunnerConfig.fromEnv({ ...env, MOIDA_RUNNER_CONCURRENCY: bad }),
        (error: Error) => error instanceof ConfigProblem && /1~8/.test(error.message),
      );
    const slot = RunnerConfig.fromEnv({
      ...rest,
      MOIDA_RUNNER_PAIRING_FILE: '/run/moida-code/pairing',
      MOIDA_RUNNER_SLOT: '1',
      MOIDA_SANDBOX: '1',
      MOIDA_AGENT_USER: 'self',
      MOIDA_RUNNER_CONCURRENCY: '4',
    });
    assert.equal(slot.concurrency, 1, '칸 하나에 일 하나');
  });

  test('코드 러너 칸은 코드 러너 이미지에서 연결 값 파일로만 시작한다', () => {
    const { MOIDA_RUNNER_TOKEN: _token, ...rest } = env;
    const slotEnv = {
      ...rest,
      MOIDA_RUNNER_PAIRING_FILE: '/run/moida-code/pairing',
      MOIDA_RUNNER_SLOT: '2',
      MOIDA_SANDBOX: '1',
      MOIDA_AGENT_USER: 'self',
    };
    const slot = RunnerConfig.fromEnv(slotEnv);
    assert.equal(slot.slot, '2');
    assert.equal(slot.withToken('got').slot, '2');
    assert.equal(RunnerConfig.fromEnv(env).slot, null, '칸 번호가 없으면 칸이 아니다');

    const refused = (changes: Record<string, string | undefined>, pattern: RegExp) =>
      assert.throws(
        () => RunnerConfig.fromEnv({ ...slotEnv, ...changes }),
        (error: Error) => error instanceof ConfigProblem && pattern.test(error.message),
      );
    for (const bad of ['0', '100', 'a', '1a']) refused({ MOIDA_RUNNER_SLOT: bad }, /1~99/);
    refused({ MOIDA_SANDBOX: undefined }, /코드 러너 이미지/);
    refused({ MOIDA_SANDBOX: 'true' }, /코드 러너 이미지/);
    refused({ MOIDA_RUNNER_TOKEN: 'device-secret' }, /연결 값 파일/);
  });

  test('칸의 AI 사용자: root인 러너만 다른 사용자로 돌린다. 작업 자리는 / 밖의 절대 경로', () => {
    const { MOIDA_RUNNER_TOKEN: _token, ...rest } = env;
    const slotEnv = {
      ...rest,
      MOIDA_RUNNER_PAIRING_FILE: '/run/moida-code/pairing',
      MOIDA_RUNNER_SLOT: '1',
      MOIDA_SANDBOX: '1',
      MOIDA_AGENT_USER: '1001:1001',
    };
    const asRoot = RunnerConfig.fromEnv(slotEnv, 0);
    assert.equal(asRoot.agentUser?.label, '1001:1001');
    assert.equal(asRoot.workDir, '/work');
    assert.equal(
      RunnerConfig.fromEnv({ ...slotEnv, MOIDA_WORK_DIR: '/tmp/w/' }, 0).workDir,
      '/tmp/w',
    );
    assert.equal(RunnerConfig.fromEnv(env).agentUser, null, '칸이 아니면 AI 사용자를 보지 않는다');

    const refused = (changes: Record<string, string | undefined>, uid: number, pattern: RegExp) =>
      assert.throws(
        () => RunnerConfig.fromEnv({ ...slotEnv, ...changes }, uid),
        (error: Error) => error instanceof ConfigProblem && pattern.test(error.message),
      );
    refused({}, 1000, /root여야/);
    refused({ MOIDA_AGENT_USER: undefined }, 0, /MOIDA_AGENT_USER/);
    refused({ MOIDA_AGENT_USER: 'agent' }, 0, /MOIDA_AGENT_USER/);
    refused({ MOIDA_AGENT_USER: '0:0' }, 0, /root가 아닌/);
    refused({ MOIDA_WORK_DIR: 'work' }, 0, /절대 경로/);
    refused({ MOIDA_WORK_DIR: '/' }, 0, /절대 경로/);
    assert.equal(
      RunnerConfig.fromEnv({ ...slotEnv, MOIDA_AGENT_USER: 'self' }, 1000).agentUser?.isSelf,
      true,
      'self는 시험용이라 root가 아니어도 된다',
    );
  });
});
