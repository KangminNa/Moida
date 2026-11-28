import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { ApiSpec } from './api-spec.policy';
import { JsonPick } from './json-pick.policy';

// API 커넥터의 정의서 (2026-11-24): AI가 쓴 JSON을 거르고, 입력으로 요청을 만들고, 답에서 값 · 상태 · 파일을 꺼낸다

const SPEC = {
  base: 'https://api.example.com/v1/',
  auth: { headers: [{ name: 'Authorization', prefix: 'Bearer' }, { name: 'x-secret' }] },
  operations: [
    {
      name: 'make_image',
      title: '그림 만들기',
      effect: 'spend',
      method: 'POST',
      path: '/models/{model}/images',
      input: {
        model: { type: 'string', required: true, enum: ['fast', 'best'] },
        prompt: { type: 'string', required: true, max: 100 },
        seed: { type: 'integer' },
        tags: { type: 'string[]' },
      },
      query: ['seed'],
      body: { params: { text: '{prompt}', tags: '{tags}' }, label: 'moida {model}' },
      pick: { id: 'request_id' },
      poll: {
        path: '/requests/{id}',
        status: 'status',
        done: ['completed'],
        failed: ['failed', 'nsfw'],
        every_seconds: 3,
        max_minutes: 5,
      },
      files: ['images[*].url', 'video.url'],
    },
    { name: 'me', title: '내 정보', effect: 'read', method: 'GET', path: '/me' },
  ],
};

describe('ApiSpec', () => {
  test('거른 정의서: 기본 주소의 끝 / 를 떼고, 머리글 · 동작을 읽는다', () => {
    const spec = ApiSpec.from(SPEC);
    assert.equal(spec.base, 'https://api.example.com/v1');
    assert.deepEqual(
      spec.headers.map((h) => h.value('k')),
      ['Bearer k', 'k'],
    );
    assert.deepEqual(
      spec.operations.map((o) => [o.name, o.effect]),
      [
        ['make_image', 'spend'],
        ['me', 'read'],
      ],
    );
    // 저장한 모양을 다시 거르면 같다
    assert.deepEqual(ApiSpec.from(spec.json()).json(), spec.json());
  });

  test('요청: 주소 틀 · 쿼리 · 본문 틀을 입력으로 채운다 (빠진 칸은 뺀다)', () => {
    const op = ApiSpec.from(SPEC).operation('make_image');
    const input = op.inputOf({ model: 'fast', prompt: '고양이', seed: 7 });
    const req = op.request('https://api.example.com/v1', input);
    assert.equal(req.method, 'POST');
    assert.equal(req.url.toString(), 'https://api.example.com/v1/models/fast/images?seed=7');
    assert.deepEqual(JSON.parse(req.body ?? ''), {
      params: { text: '고양이' },
      label: 'moida fast',
    });
    const get = ApiSpec.from(SPEC).operation('me').request('https://api.example.com/v1', {});
    assert.deepEqual([get.method, get.body], ['GET', null]);
  });

  test('입력 검사: 모르는 칸 · 빠진 칸 · 종류 · 목록 · 길이', () => {
    const op = ApiSpec.from(SPEC).operation('make_image');
    assert.throws(
      () => op.inputOf({ model: 'fast', prompt: 'a', x: 1 }),
      /모르는 입력 칸이에요: x/,
    );
    assert.throws(() => op.inputOf({ model: 'fast' }), /입력 prompt이 필요해요/);
    assert.throws(() => op.inputOf({ model: 'slow', prompt: 'a' }), /fast · best 중 하나예요/);
    assert.throws(() => op.inputOf({ model: 'fast', prompt: 'a', seed: 1.5 }), /정수여야 해요/);
    assert.throws(() => op.inputOf({ model: 'fast', prompt: 'a'.repeat(101) }), /너무 길어요/);
  });

  test('주소를 채운 값은 한 조각으로 인코딩돼 경로를 벗어나지 못한다', () => {
    const op = ApiSpec.from({
      base: 'https://api.example.com/v1',
      operations: [
        {
          name: 'get',
          title: '읽기',
          effect: 'read',
          method: 'GET',
          path: '/items/{id}',
          input: { id: { type: 'string', required: true } },
        },
      ],
    }).operation('get');
    const req = op.request('https://api.example.com/v1', { id: '../../admin?x=1' });
    assert.equal(req.url.pathname, '/v1/items/..%2F..%2Fadmin%3Fx%3D1');
    assert.equal(req.url.host, 'api.example.com');
  });

  test('상태 묻기 · 꺼낼 값 · 파일 주소 (https만)', () => {
    const op = ApiSpec.from(SPEC).operation('make_image');
    assert.deepEqual(op.picked({ request_id: 'r1', other: 1 }, false), { id: 'r1' });
    const poll = op.pollRequest('https://api.example.com/v1', { id: 'r1' });
    assert.equal(poll?.url.toString(), 'https://api.example.com/v1/requests/r1');
    assert.equal(op.poll?.stateOf({ status: 'running' }), 'waiting');
    assert.equal(op.poll?.stateOf({ status: 'completed' }), 'done');
    assert.equal(op.poll?.stateOf({ status: 'nsfw' }), 'failed');
    const done = {
      images: [{ url: 'https://cdn.example.com/a.png' }, { url: 'ftp://x/b.png' }],
      video: { url: 'https://cdn.example.com/v.mp4' },
    };
    assert.deepEqual(op.fileUrls(done), [
      'https://cdn.example.com/a.png',
      'https://cdn.example.com/v.mp4',
    ]);
  });

  test('받지 않는 정의서: http · IP 주소 · .. 경로 · 없는 칸을 쓰는 주소 · 예약 머리글 · GET 본문', () => {
    const bad =
      (patch: Record<string, unknown>, op: Record<string, unknown> = {}) =>
      () =>
        ApiSpec.from({
          ...SPEC,
          ...patch,
          operations: [{ ...SPEC.operations[1], ...op }],
        });
    assert.throws(bad({ base: 'http://api.example.com' }), /https 주소만/);
    assert.throws(bad({ base: 'https://10.0.0.1/v1' }), /이름으로 적어요/);
    assert.throws(bad({}, { path: '/a/../b' }), /경로예요/);
    assert.throws(bad({}, { path: '/a/{nope}' }), /\{nope\}가 입력에 없어요/);
    assert.throws(bad({ auth: { headers: [{ name: 'Cookie' }] } }), /머리글 이름이 맞지 않아요/);
    assert.throws(bad({}, { body: { a: 1 } }), /GET는 본문을 보내지 않아요/);
    assert.throws(bad({}, { effect: 'delete' }), /read · spend · write/);
  });
});

describe('JsonPick', () => {
  test('경로 모양과 꺼내기', () => {
    const v = { a: { b: [{ c: 1 }, { c: 2 }] }, x: 'y' };
    assert.equal(JsonPick.get(v, 'a.b[1].c'), 2);
    assert.deepEqual(JsonPick.get(v, 'a.b[*].c'), [1, 2]);
    assert.equal(JsonPick.get(v, 'a.z'), undefined);
    assert.deepEqual(JsonPick.get(v, ''), v);
    assert.throws(() => JsonPick.check('a..b', 'pick'), /경로 모양이 맞지 않아요/);
    assert.throws(() => JsonPick.check('$.a', 'pick'), /경로 모양이 맞지 않아요/);
  });
});
