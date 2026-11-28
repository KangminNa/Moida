import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, test } from 'node:test';
import { MapLookup } from './map-lookup';
import { type MapSearchBases, MapSearchGateway } from './map-search.gateway';
import { GeocodeCheck, MapUsage, SearchPlaces } from './operations';

// 지도 찾기 (docs/지도.md MP-2): 회사 응답을 테스트용 웹 서버(127.0.0.1)로 흉내 내고, 서버 키가 머리글 · 주소로만 가는지,
// 회사마다 다른 응답이 같은 모양이 되는지, 곳마다 · 하루 상한과 10분 기억을 본다

type Seen = { path: string; headers: IncomingMessage['headers']; body: string };
const seen: Seen[] = [];
let server: Server;
let bases: MapSearchBases;

const ANSWERS: Record<string, unknown> = {
  '/v2/local/search/keyword.json': {
    documents: [
      {
        place_name: '빵집',
        road_address_name: '서울 중구 1',
        address_name: '중구 1-1',
        x: '126.9',
        y: '37.5',
        id: '11',
      },
    ],
  },
  '/v2/local/search/address.json': {
    documents: [{ address_name: '서울 중구 세종대로 110', x: '126.97', y: '37.56' }],
  },
  '/v2/local/geo/coord2address.json': {
    documents: [
      {
        road_address: { address_name: '서울 중구 세종대로 110' },
        address: { address_name: '태평로1가 31' },
      },
    ],
  },
  '/map-geocode/v2/geocode': {
    addresses: [
      { roadAddress: '서울 중구 세종대로 110', jibunAddress: '', x: '126.97', y: '37.56' },
    ],
  },
  '/map-reversegeocode/v2/gc': {
    results: [
      {
        region: {
          area1: { name: '서울특별시' },
          area2: { name: '중구' },
          area3: { name: '태평로1가' },
          area4: { name: '' },
        },
        land: { name: '', number1: '31', number2: '' },
      },
    ],
  },
  '/maps/api/geocode/json': {
    status: 'OK',
    results: [
      {
        formatted_address: '서울 중구 세종대로 110',
        geometry: { location: { lat: 37.56, lng: 126.97 } },
        place_id: 'g1',
      },
    ],
  },
  '/v1/places:searchText': {
    places: [
      {
        id: 'p1',
        displayName: { text: '빵집' },
        formattedAddress: '서울 중구',
        location: { latitude: 37.5, longitude: 126.9 },
      },
    ],
  },
};

before(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => {
      body += c;
    });
    req.on('end', () => {
      const path = (req.url ?? '').split('?')[0] ?? '';
      seen.push({ path: req.url ?? '', headers: req.headers, body });
      const answer = ANSWERS[path];
      res.writeHead(answer ? 200 : 404, { 'content-type': 'application/json' });
      res.end(JSON.stringify(answer ?? { error: 'none' }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  bases = { kakao: origin, naver: origin, google: origin, googlePlaces: origin };
});

after(() => server.close());

const KEYS = {
  kakao: 'KAKAO-REST',
  naverId: 'NCP-ID',
  naverSecret: 'NCP-SECRET',
  google: 'G-SERVER',
};
const last = () => seen[seen.length - 1] as Seen;

describe('MapSearchGateway', () => {
  test('카카오: REST 키는 KakaoAK 머리글로, 키워드 찾기 · 주소 · 역지오코딩이 같은 모양', async () => {
    const kakao = new MapSearchGateway('kakao', KEYS, bases);
    const places = await kakao.search('빵집', { lat: 37.5, lng: 126.9 }, 5);
    assert.deepEqual(places, [
      { name: '빵집', address: '서울 중구 1', lat: 37.5, lng: 126.9, id: '11' },
    ]);
    assert.equal(last().headers.authorization, 'KakaoAK KAKAO-REST');
    assert.match(last().path, /query=%EB%B9%B5%EC%A7%91.*x=126\.9&y=37\.5/);
    assert.deepEqual(await kakao.geocode('세종대로 110'), {
      name: '서울 중구 세종대로 110',
      address: '서울 중구 세종대로 110',
      lat: 37.56,
      lng: 126.97,
      id: '',
    });
    assert.equal(await kakao.reverse(37.56, 126.97), '서울 중구 세종대로 110');
  });

  test('네이버: Client ID · Secret은 x-ncp-apigw 머리글로, 장소 찾기는 주소 찾기로 대신', async () => {
    const naver = new MapSearchGateway('naver', KEYS, bases);
    const [place] = await naver.search('세종대로 110', null, 5);
    assert.equal(place?.address, '서울 중구 세종대로 110');
    assert.equal(last().headers['x-ncp-apigw-api-key-id'], 'NCP-ID');
    assert.equal(last().headers['x-ncp-apigw-api-key'], 'NCP-SECRET');
    assert.equal(await naver.reverse(37.56, 126.97), '서울특별시 중구 태평로1가 31');
    assert.match(last().path, /coords=126\.97%2C37\.56/);
  });

  test('구글: 장소 찾기는 X-Goog-Api-Key · 필드 마스크로, 지오코딩은 key=', async () => {
    const google = new MapSearchGateway('google', KEYS, bases);
    const places = await google.search('빵집', { lat: 37.5, lng: 126.9 }, 3);
    assert.deepEqual(places, [
      { name: '빵집', address: '서울 중구', lat: 37.5, lng: 126.9, id: 'p1' },
    ]);
    assert.equal(last().headers['x-goog-api-key'], 'G-SERVER');
    assert.match(String(last().headers['x-goog-fieldmask']), /places\.location/);
    assert.deepEqual(JSON.parse(last().body).maxResultCount, 3);
    assert.equal((await google.geocode('세종대로'))?.id, 'g1');
    assert.match(last().path, /key=G-SERVER/);
  });

  test('회사가 거절하면 상태 번호만 알린다 (주소 · 키를 오류 글에 넣지 않는다)', async () => {
    const broken = new MapSearchGateway('kakao', KEYS, { ...bases, kakao: `${bases.kakao}/nope` });
    await assert.rejects(broken.search('빵집', null, 5), (error: Error) => {
      assert.match(error.message, /404/);
      assert.doesNotMatch(error.message, /KAKAO-REST|127\.0\.0\.1/);
      return true;
    });
  });
});

describe('MapLookup', () => {
  test('같은 질문은 10분 기억하고, 하루 상한을 넘으면 429, 찾기를 켜지 않았으면 404', async () => {
    const gateway = new MapSearchGateway('kakao', KEYS, bases);
    const lookup = new MapLookup(gateway, 'kakao', MapLookup.spentToday() + 1);
    let asked = 0;
    const ask = async () => {
      asked += 1;
      return 'ok';
    };
    const now = Date.now();
    assert.equal(await lookup.answer('203.0.113.1', 'k:a', ask, now), 'ok');
    assert.equal(await lookup.answer('203.0.113.1', 'k:a', ask, now + 1000), 'ok');
    assert.equal(asked, 1, '10분 안의 같은 질문은 회사에 다시 묻지 않는다');
    await assert.rejects(lookup.answer('203.0.113.1', 'k:b', ask, now + 2000), /한도/);
    await assert.rejects(
      new MapLookup(null, 'none', 10).answer('203.0.113.1', 'k:c', ask),
      /켜지 않았어요/,
    );
  });

  test('곳(IP)마다 1분에 30번까지, 기억한 답은 세지 않는다', async () => {
    const lookup = new MapLookup(new MapSearchGateway('kakao', KEYS, bases), 'kakao', 1_000_000);
    const now = Date.now();
    for (let i = 0; i < MapLookup.PER_MINUTE; i++)
      await lookup.answer('198.51.100.9', `minute:${i}`, async () => 'x', now);
    await assert.rejects(
      lookup.answer('198.51.100.9', 'minute:new', async () => 'x', now),
      /너무 많이/,
    );
    assert.equal(
      await lookup.answer('198.51.100.9', 'minute:0', async () => 'y', now),
      'x',
      '이미 찾은 주소는 한도를 다 써도 기억한 답',
    );
    assert.equal(await lookup.answer('198.51.100.10', 'minute:new', async () => 'x', now), 'x');
  });
});

describe('GeocodeCheck (일꾼 도구 map_geocode)', () => {
  test('주소마다 found · 찾은 주소 · 좌표, 같은 주소는 한 번만, 확인용 안내', async () => {
    const lookup = new MapLookup(new MapSearchGateway('kakao', KEYS, bases), 'kakao', 1_000_000);
    const check = new GeocodeCheck(lookup, 'kakao', '카카오');
    assert.equal(check.allow, 'agent_out', '주소가 바깥 회사로 나가니 에이전트만');
    const input = check.input({ addresses: [' 세종대로 110 ', '세종대로 110'] });
    assert.deepEqual(input, { addresses: ['세종대로 110'] });
    const view = await check.run({ place: '192.0.2.40' } as never, undefined as never, input);
    const json = view.toJSON();
    assert.deepEqual(json.results, [
      {
        address: '세종대로 110',
        found: true,
        matched: '서울 중구 세종대로 110',
        lat: 37.56,
        lng: 126.97,
      },
    ]);
    assert.equal(json.found, 1);
    assert.match(json.note, /넣지 말고/);
  });

  test('주소는 1~20개, 빈 글 · 200자 넘는 글은 400', () => {
    const check = new GeocodeCheck(new MapLookup(null, 'none', 0), 'none', '');
    assert.throws(() => check.input({ addresses: [] }), /InvalidRequest|입력/);
    assert.throws(() => check.input({ addresses: Array(21).fill('a') }));
    assert.throws(() => check.input({ addresses: [' '] }));
    assert.throws(() => check.input({ addresses: ['가'.repeat(201)] }));
    assert.throws(() => check.input({}));
  });
});

describe('MapUsage', () => {
  test('관리자만, 회사 · 켜짐 · 오늘 부른 수 · 하루 상한', async () => {
    const usage = new MapUsage('kakao', true, 50000);
    assert.equal(usage.allow, 'owner');
    const view = await usage.run(undefined as never, undefined as never);
    assert.deepEqual(view.toJSON(), {
      provider: 'kakao',
      ready: true,
      today: MapLookup.spentToday(),
      limit: 50000,
    });
  });
});

describe('SearchPlaces 입력', () => {
  const search = new SearchPlaces(new MapLookup(null, 'none', 0), 'none', '');
  test('q는 필수, size는 1~15, 좌표는 둘 다 · 범위 안', () => {
    assert.deepEqual(search.input({ q: ' 빵집 ', lat: '37.5', lng: '126.9' }), {
      q: '빵집',
      near: { lat: 37.5, lng: 126.9 },
      size: 10,
    });
    assert.throws(() => search.input({}), /q/);
    assert.throws(() => search.input({ q: '빵', size: '16' }), /size/);
    assert.throws(() => search.input({ q: '빵', lat: '37.5' }), /lat/);
    assert.throws(() => search.input({ q: '빵', lat: '91', lng: '0' }), /lat/);
  });
});
