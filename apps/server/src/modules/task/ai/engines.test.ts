import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  AGENT_EFFORT,
  AGENT_TOOL,
  AI_LOGIN_TOOL,
  PLAN_USAGE_PERIOD,
  PLAN_USAGE_TOOL,
} from '../task.tables';
import { EngineLogin, Engines } from './engines';

// 엔진 목록 (리팩토링 E1, task/engines.json): 파일이 DB 값 목록과 맞는지, 로그인의 모양 규칙이 그대로인지

describe('engines.json', () => {
  test('엔진 이름은 DB 값 목록 셋(agents · ai_logins · plan_usage의 도구)과 같다', () => {
    const names = [...Engines.names()].sort();
    assert.deepEqual(names, [...AGENT_TOOL].sort());
    assert.deepEqual(names, [...AI_LOGIN_TOOL].sort());
    assert.deepEqual(names, [...PLAN_USAGE_TOOL].sort());
  });

  test('강도 · 사용률 창은 DB 값 목록 안, 모델은 [값, 이름] 짝, 로그인 흐름은 둘 중 하나', () => {
    for (const engine of Engines.list()) {
      const view = engine.view().toJSON();
      for (const effort of view.efforts)
        assert.ok(
          (AGENT_EFFORT as readonly string[]).includes(effort),
          `${engine.name}: ${effort}`,
        );
      for (const period of view.windows)
        assert.ok(
          (PLAN_USAGE_PERIOD as readonly string[]).includes(period),
          `${engine.name}: ${period}`,
        );
      for (const model of view.models ?? []) {
        assert.equal(typeof model.value, 'string');
        assert.ok(model.label.length > 0);
      }
      assert.ok([EngineLogin.PASTE_CODE, EngineLogin.DEVICE_CODE].includes(view.login.flow));
    }
  });

  test('기본은 첫 줄, 모르는 이름은 RuleViolation · find는 null', () => {
    assert.equal(Engines.preferred(), Engines.names()[0]);
    assert.throws(() => Engines.of('gpt'), /AI 도구는/);
    assert.equal(Engines.find('gpt'), null);
    assert.deepEqual(Engines.rotating(), ['codex']);
  });
});

describe('EngineLogin (옛 AiSigninPolicy의 규칙)', () => {
  const claude = Engines.of('claude').login;
  const codex = Engines.of('codex').login;

  test('로그인 주소: 정해진 출처 · 경로만. Codex는 쿼리도 없이, 토큰이 섞이면 거절', () => {
    claude.assertUrl('https://claude.ai/oauth/authorize?code=true&client_id=x');
    claude.assertUrl('https://claude.com/cai/oauth/authorize?x=1');
    codex.assertUrl('https://auth.openai.com/codex/device');
    for (const [login, url] of [
      [claude, 'https://evil.example/oauth/authorize'],
      [claude, 'https://claude.ai/oauth/authorize#frag'],
      [claude, 'https://user:pw@claude.ai/oauth/authorize'],
      [claude, 'https://claude.ai/oauth/authorize?t=SK-ANT-oat01-abc'],
      [codex, 'https://auth.openai.com/codex/device?x=1'],
      [codex, '아님'],
    ] as const)
      assert.throws(() => login.assertUrl(url), /로그인 주소/);
  });

  test('코드: 기기 코드 흐름은 꼭 있고, 코드를 붙여 넣는 흐름은 없다', () => {
    codex.assertUserCode('ABCD-12345');
    claude.assertUserCode(null);
    assert.throws(() => codex.assertUserCode(null));
    assert.throws(() => codex.assertUserCode('ABC-1'));
    assert.throws(() => claude.assertUserCode('ABCD-12345'));
    EngineLogin.assertBrowserCode('abcd#efgh');
    assert.throws(() => EngineLogin.assertBrowserCode('ab cd'), /공백 없이/);
  });

  test('자격: 토큰은 정해진 모양, auth.json은 크기 안의 객체. 기간과 갱신', () => {
    claude.assertCredential(`sk-ant-oat01-${'a'.repeat(30)}`);
    assert.throws(
      () => claude.assertCredential('sk-ant-api03-x'),
      /setup-token의 토큰 모양이 아니에요/,
    );
    codex.assertCredential('{"tokens":{}}');
    assert.throws(() => codex.assertCredential('[]'), /auth\.json의 모양이 아니에요/);
    assert.throws(() => codex.assertCredential('x'.repeat(65_537)), /auth\.json이 너무 커요/);
    const now = new Date('2026-11-16T00:00:00Z');
    assert.equal(claude.termFrom(now)?.toISOString(), '2027-11-16T00:00:00.000Z');
    assert.equal(codex.termFrom(now), null);
    assert.deepEqual([claude.pastesCode, claude.takesToken, claude.rotating], [true, true, false]);
    assert.deepEqual([codex.pastesCode, codex.takesToken, codex.rotating], [false, false, true]);
    assert.equal(claude.tokenPrefix, 'sk-ant-oat');
  });
});
