import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { Actor, AgentActor } from './actor';
import { LegacyEnv } from './legacy-env';
import { SecretBox } from './secret-box';

// 옛 이름 받기 (2026-11-28 이름 cairn → moida): 이미 배포한 .env의 CAIRN_* · 그 전에 나간 작업 토큰(cairn_run_)

describe('LegacyEnv: 옛 이름의 환경 변수', () => {
  test('CAIRN_X만 있으면 MOIDA_X로 옮기고, 새 이름이 있으면 그대로 둔다', () => {
    const env: Record<string, string | undefined> = {
      CAIRN_SECRET_KEY: 'old-key',
      CAIRN_WEB_URL: 'https://old.example.com',
      MOIDA_WEB_URL: 'https://new.example.com',
      OTHER: 'x',
    };
    const warned: string[] = [];
    const moved = LegacyEnv.adopt(env, (text) => warned.push(text));
    assert.deepEqual(moved, ['MOIDA_SECRET_KEY']);
    assert.equal(env.MOIDA_SECRET_KEY, 'old-key');
    assert.equal(env.MOIDA_WEB_URL, 'https://new.example.com');
    assert.equal(env.OTHER, 'x');
    assert.equal(warned.length, 1);
    assert.match(warned[0] ?? '', /CAIRN_SECRET_KEY/);
    assert.doesNotMatch(warned[0] ?? '', /CAIRN_WEB_URL/);
  });

  test('옮길 것이 없으면 아무것도 바꾸지 않는다', () => {
    const env: Record<string, string | undefined> = { MOIDA_WEB_URL: 'https://a.example.com' };
    assert.deepEqual(
      LegacyEnv.adopt(env, () => assert.fail('알리지 않는다')),
      [],
    );
    assert.deepEqual(env, { MOIDA_WEB_URL: 'https://a.example.com' });
  });
});

describe('AgentActor: 옛 이름의 작업 토큰', () => {
  const box = SecretBox.fromEnv({ MOIDA_SECRET_KEY: SecretBox.newKey() });

  test('cairn_run_으로 시작하는 토큰도 작업 토큰으로 풀린다 (이름을 바꾸기 전에 나간 토큰)', () => {
    const agent = new AgentActor('s', 'a', 't', new Set([Actor.READ_ALL]));
    const token = agent.seal(box, 60);
    assert.ok(token.startsWith('moida_run_'));
    const old = `cairn_run_${token.slice('moida_run_'.length)}`;
    assert.ok(AgentActor.isToken(old));
    const opened = AgentActor.open(box, old);
    assert.equal(opened?.taskId, 't');
    assert.ok(opened?.can(Actor.READ_ALL));
    assert.equal(AgentActor.open(box, `other_run_${token.slice('moida_run_'.length)}`), null);
  });
});
