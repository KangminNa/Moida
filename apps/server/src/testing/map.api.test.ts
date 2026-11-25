import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { ApiClient, type TestUser } from './api-client';

// 지도 플러그인의 찾기 경로 (docs/지도.md MP-2): /api/p/map/search · geocode · reverse. 방문자도 부른다 (공개 앱의 화면).
// 회사를 실제로 부르는 것은 plugins/map/server/map-search.test.ts(테스트용 웹 서버)가 보고, 여기서는 켜기 · 설정 · 입력 · 비밀을 본다

type Json = Record<string, unknown>;

let api: ApiClient;
let owner: TestUser;

before(async () => {
  api = await ApiClient.start();
  owner = await api.signIn();
  const on = await api.request('POST', '/api/plugins/map/enable', owner);
  assert.equal(on.status, 200, on.text);
});
after(() => api.close());

const settings = (values: Json) =>
  api.request('PUT', '/api/plugins/map/settings', owner, { values });

describe('지도 찾기 (/api/p/map)', () => {
  test('찾기 회사를 고르지 않았으면 방문자에게 404, 입력이 틀리면 400과 칸', async () => {
    const off = await api.get('/api/p/map/search?q=%EB%B9%B5%EC%A7%91');
    assert.equal(off.status, 404, off.text);
    assert.match(String((off.json() as Json).message), /켜지 않았어요/);
    const bad = await api.get('/api/p/map/search?q=%EB%B9%B5&lat=91&lng=0');
    assert.equal(bad.status, 400, bad.text);
    assert.ok(((bad.json() as Json).fields as Json).lat);
    assert.equal((await api.get('/api/p/map/reverse')).status, 400);
  });

  test('서버 키는 공개 설정에 나가지 않고, 키가 비었거나 구글을 구글 지도 없이 고르면 꺼진 것과 같다', async () => {
    assert.equal(
      (await settings({ searchProvider: 'kakao', kakaoRestKey: 'KAKAO-REST-SECRET' })).status,
      200,
    );
    const shown = await api.get('/api/plugins/map/settings');
    assert.equal(shown.status, 200, shown.text);
    assert.equal(shown.text.includes('KAKAO-REST-SECRET'), false);
    assert.equal((shown.json() as { settings: Json }).settings.searchProvider, undefined);

    assert.equal((await settings({ searchProvider: 'naver', naverClientSecret: 's' })).status, 200);
    const noId = await api.get('/api/p/map/geocode?address=%EC%84%B8%EC%A2%85%EB%8C%80%EB%A1%9C');
    assert.equal(noId.status, 404, '네이버는 Client ID도 있어야 한다');

    assert.equal(
      (await settings({ searchProvider: 'google', googleServerKey: 'g', provider: 'osm' })).status,
      200,
    );
    const google = await api.get('/api/p/map/search?q=%EB%B9%B5');
    assert.equal(google.status, 404, '구글 찾기는 구글 지도와 함께만');
  });
});
