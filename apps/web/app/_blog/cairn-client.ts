import { cairnMapScript } from './cairn-map';
import type { MapChoice } from './map-config';

// cairn.js (앱 플랫폼, docs/스토어.md 12.4): 앱 코드가 Cairn의 기능을 부르는 작은 스크립트. 앱은 <script src="_/cairn.js">로 싣는다
// (앱 도메인에서는 /_/cairn.js, 기본 도메인 · 미리 보기에서는 /<앱>/_/cairn.js: <base> 덕에 같은 상대 주소다).
// 앱은 Cairn의 주소 · 응답 모양을 직접 알지 않고 이 약속만 쓴다:
//   cairn.open                         이 화면이 격리를 푼 화면인가 (그 앱의 도메인으로 연 공개 화면). 거짓이면 회원 · 데이터를 쓰지 못한다
//   cairn.me()                         → { member: { nickname, … } | null }
//   cairn.login(돌아올 곳?) · cairn.join(돌아올 곳?) · cairn.logout()     가입 · 로그인은 Cairn의 고정 화면이 한다 (비밀번호는 앱 코드를 거치지 않는다)
//   cairn.from('표').select().eq('칸', 값).order('칸', 'desc').limit(10)   → { rows, more }  (조건: eq neq gt gte lt lte, 내 줄만: .mine())
//   cairn.from('표').insert({…}) · .update(id, {…}) · .delete(id)
//   cairn.community.topics(cursor?) · topic(id) · write({title, body}) · edit(id, {version, title, body}) · remove(id, version)
//                  · comment(topicId, body) · removeComment(id, version) · report({topicId | commentId, reason, note?})
//   cairn.page                         이 화면 주소의 데이터 (화면에 실려 온 cairn-data 블록, 없으면 null)
//   cairn.data(주소?, 다음 쪽?)          → 그 주소의 데이터 (약속 cairn: 1). '' 첫 화면 · 'posts/<글>' · 'm/<메뉴>' · 'm/<메뉴>/<번호>'.
//                                       다른 공개 앱의 글이면 { redirect }만 온다 (2026-11-25, 스토어 14장 A3: 템플릿 없이 글 · 메뉴 · 호를 그린다)
//   cairn.map.provider · cairn.map.create(자리, { places })   지도 (지도 플러그인, 약속은 cairn-map.ts)
// 실패하면 Error를 던진다 (status · code가 붙는다). 쓰기 확인 값(CSRF)은 스크립트가 me에서 읽어 싣는다.
// 브라우저에서 그대로 도는 글자다: 빌드를 거치지 않는다

const SOURCE = String.raw`(() => {
  const OPEN = __OPEN__;
  const API = '/api/community';
  let csrf = null;
  const fail = (message, status, code) => Object.assign(new Error(message), { status, code });
  const closed = () => Promise.reject(fail('앱의 도메인에서 연 화면에서만 쓸 수 있어요', 0, 'closed'));
  const requestId = () => {
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
    return [h.slice(0, 8), h.slice(8, 12), h.slice(12, 16), h.slice(16, 20), h.slice(20)].join('-');
  };
  async function call(method, path, body) {
    if (!OPEN) return closed();
    const headers = {};
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (method !== 'GET') {
      if (csrf === null) await me();
      if (csrf) headers['x-cairn-csrf'] = csrf;
    }
    const res = await fetch(API + path, {
      method,
      headers,
      credentials: 'same-origin',
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status === 204) return null;
    const data = await res.json().catch(() => null);
    if (!res.ok) throw fail((data && data.message) || '요청하지 못했어요', res.status, data && data.code);
    return data;
  }
  async function me() {
    if (!OPEN) return { member: null };
    const data = await call('GET', '/me');
    csrf = data.csrf || '';
    return { member: data.member };
  }
  const go = (screen, back) => {
    const to = back || location.pathname + location.search;
    location.href = '/_/' + screen + '?return=' + encodeURIComponent(to);
  };
  function from(table) {
    const at = '/data/' + encodeURIComponent(table);
    const filters = [];
    let order = null;
    let limit = null;
    let offset = null;
    const run = () => {
      const params = new URLSearchParams();
      for (const [column, op, value] of filters) params.append(column, op + '.' + value);
      if (order) params.set('order', order);
      if (limit !== null) params.set('limit', String(limit));
      if (offset !== null) params.set('offset', String(offset));
      const query = params.toString();
      return call('GET', at + (query ? '?' + query : ''));
    };
    const query = {
      select: () => query,
      mine: () => (filters.push(['owner', 'eq', 'me']), query),
      order: (column, direction) => ((order = column + '.' + (direction === 'asc' ? 'asc' : 'desc')), query),
      limit: (n) => ((limit = n), query),
      offset: (n) => ((offset = n), query),
      then: (resolve, reject) => run().then(resolve, reject),
      insert: (values) => call('POST', at, values),
      update: (id, values) => call('PATCH', at + '/' + id, values),
      delete: (id) => call('DELETE', at + '/' + id),
    };
    for (const op of ['eq', 'neq', 'gt', 'gte', 'lt', 'lte'])
      query[op] = (column, value) => (filters.push([column, op, value]), query);
    return query;
  }
  const community = {
    topics: (cursor) => call('GET', '/topics' + (cursor ? '?cursor=' + encodeURIComponent(cursor) : '')),
    topic: (id) => call('GET', '/topics/' + id),
    write: (topic) => call('POST', '/topics', { requestId: requestId(), title: topic.title, body: topic.body }),
    edit: (id, topic) => call('PATCH', '/topics/' + id, topic),
    remove: (id, version) => call('DELETE', '/topics/' + id, { version }),
    comment: (topicId, body) => call('POST', '/topics/' + topicId + '/comments', { requestId: requestId(), body }),
    removeComment: (id, version) => call('DELETE', '/comments/' + id, { version }),
    report: (report) => call('POST', '/reports', report),
  };
  // 화면에 실려 온 데이터 (정적 앱 · 템플릿 앱 모두). 앱의 주소 앞부분(base)도 여기서 안다
  const page = (() => {
    try {
      const block = document.getElementById('cairn-data');
      return block ? JSON.parse(block.textContent || 'null') : null;
    } catch {
      return null;
    }
  })();
  async function data(path, cursor) {
    const base = page && typeof page.base === 'string' && page.base !== '/' ? page.base : '';
    const params = new URLSearchParams({ path: String(path || '').replace(/^\/+/, '') });
    if (cursor) params.set('cursor', cursor);
    const res = await fetch(base + '/_/data?' + params, { credentials: 'omit' });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body) throw fail((body && body.message) || '읽지 못했어요', res.status, 'data');
    return body.redirect ? { redirect: body.redirect } : body.data;
  }
  window.cairn = {
    open: OPEN,
    page,
    data,
    me,
    login: (back) => go('login', back),
    join: (back) => go('join', back),
    logout: async () => {
      await call('POST', '/logout');
      csrf = null;
    },
    from,
    community,
  };
})();
`;

/**
 * cairn.js의 글자. open: 격리를 푼 화면에서 싣는가 (그 앱의 도메인, 미리 보기 아님).
 * 뒤에 지도(cairn.map, 지도 플러그인)를 붙인다: 격리된 화면이면 키가 필요 없는 OpenStreetMap
 */
function cairnScript(open: boolean, map: MapChoice): string {
  return `${SOURCE.replace('__OPEN__', open ? 'true' : 'false')}\n${cairnMapScript(map)}`;
}

/** cairn.js의 응답. 버전마다 바뀔 수 있어 오래 담아 두지 않는다 */
export function cairnAnswer(open: boolean, map: MapChoice): Response {
  return new Response(cairnScript(open, map), {
    status: 200,
    headers: {
      'Content-Type': 'text/javascript; charset=utf-8',
      'Cache-Control': open ? 'public, max-age=300' : 'no-store',
      'X-Content-Type-Options': 'nosniff',
      // 격리된 화면(출처 없는 문서)도 모듈로 읽을 수 있게
      'Access-Control-Allow-Origin': '*',
    },
  });
}
