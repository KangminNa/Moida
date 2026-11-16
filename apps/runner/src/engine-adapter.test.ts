import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { EngineAdapters } from './engine-adapter';

// 러너의 엔진 등록부는 서버의 엔진 목록(apps/server/src/modules/task/engines.json)과 같다 (리팩토링 E2).
// 러너는 서버 코드를 가져오지 않아서(MCP로만 이야기한다) 목록 파일을 글로 읽어 맞춰 본다.

type Engine = { efforts: string[]; login: { flow: string } };

const file = resolve(__dirname, '../../server/src/modules/task/engines.json');
const engines = (JSON.parse(readFileSync(file, 'utf8')) as { engines: Record<string, Engine> })
  .engines;

test('러너가 아는 엔진은 엔진 목록과 같은 이름 · 같은 순서다', () => {
  assert.deepEqual([...EngineAdapters.names()], Object.keys(engines));
});

test('엔진마다 생각 강도와 로그인 방식이 엔진 목록과 같다', () => {
  for (const engine of EngineAdapters.list()) {
    const listed = engines[engine.name] as Engine;
    assert.deepEqual([...engine.efforts], listed.efforts, `${engine.name} 강도`);
    assert.equal(engine.signin.flow, listed.login.flow, `${engine.name} 로그인`);
  }
});

test('실행 파일의 환경 변수는 엔진마다 다르고, 모르는 이름은 어댑터가 없다', () => {
  const envs = EngineAdapters.list().map((engine) => engine.bin.env);
  assert.equal(new Set(envs).size, envs.length);
  assert.equal(EngineAdapters.of('gemini'), null);
  assert.equal(EngineAdapters.of('constructor'), null);
});
