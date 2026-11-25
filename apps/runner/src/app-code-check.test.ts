import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, test } from 'node:test';
import { deflateRawSync } from 'node:zlib';
import { AgentUser } from './agent-user';
import { AppCodeBase } from './app-code-base';
import { AppCodeCheck, AppCodeEntry } from './app-code-check';
import type { CairnServer } from './cairn-server';
import { DesignCheck } from './design-check';
import { DesignDocCheck } from './design-doc-check';
import { Job } from './job';
import { Json } from './json';
import { MakeStage } from './make-stage';
import { PromptPack } from './prompt-pack';
import { Redactor, RunLog } from './redactor';
import { RunnerConfig } from './runner-config';
import type { StageCheck } from './stage-check';
import { ZipIndex } from './zip-index';

/** 지도 플러그인의 회사 스크립트 호스트 (plugins/map/providers.json의 sdkHosts) */
const mapSdkHosts = (): string[] => {
  const file = resolve(__dirname, '../../../plugins/map/providers.json');
  const spec = JSON.parse(readFileSync(file, 'utf8')) as {
    providers: Record<string, { sdkHosts: string[] }>;
  };
  return Object.values(spec.providers).flatMap((p) => p.sdkHosts);
};

// 앱 코드를 고치는 만들기 일 (스토어 1-6c): 지금 코드 받기(app_code_base) · 지시 단락 · 묶음과 템플릿 검사.

const id = (n: number) => `00000000-0000-7000-8000-${String(n).padStart(12, '0')}`;
const STARTERS = resolve(__dirname, '../../server/starters');
const scan = (text: string, partials: readonly string[] = []) =>
  AppCodeCheck.scan(text, (name) => partials.includes(name));
const codeOf = (files: object[], hosts: string[] = []) =>
  AppCodeBase.from(
    Json.of({
      app_id: id(1),
      name: '개발 블로그',
      kind: 'blog',
      slug: 'dev',
      seq: 0,
      files,
      hosts,
    }),
  ) as AppCodeBase;
// 디자인 기준 · 디자인 문서 검사는 design-check.test · design-doc-check.test에서 본다: 여기 본보기 코드는 화면 조각이다
const short = (checks: readonly StageCheck[]) =>
  checks
    .filter((c) => c.name !== DesignCheck.NAME && c.name !== DesignDocCheck.NAME)
    .map((c) => [c.name, c.ok, c.how]);

/** 테스트용 zip 만들기: 파일마다 deflate (packed가 false면 그대로 담는다). 러너에는 zip을 쓰는 코드가 없다 */
function zipOf(files: Readonly<Record<string, string>>, packed = true): Buffer {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let at = 0;
  for (const [path, text] of Object.entries(files)) {
    const name = Buffer.from(path);
    const data = Buffer.from(text);
    const body = packed ? deflateRawSync(data) : data;
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(packed ? 8 : 0, 8);
    head.writeUInt32LE(body.length, 18);
    head.writeUInt32LE(data.length, 22);
    head.writeUInt16LE(name.length, 26);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(packed ? 8 : 0, 10);
    entry.writeUInt32LE(body.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(name.length, 28);
    entry.writeUInt32LE(at, 42);
    locals.push(head, name, body);
    central.push(entry, name);
    at += 30 + name.length + body.length;
  }
  const list = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(list.length, 12);
  end.writeUInt32LE(at, 16);
  return Buffer.concat([...locals, list, end]);
}

describe('템플릿 훑기 (AppCodeCheck.scan)', () => {
  test('시작 코드 셋의 템플릿은 문제도 모르는 이름도 없다', async () => {
    for (const kind of ['blog', 'magazine', 'page', 'community']) {
      const names = new Map<string, string>();
      // 페이지 앱은 블로그 틀(base) 없이 자기 셋만 (서버 AppStarterGateway.ALONE, 2026-11-20)
      for (const dir of kind === 'page' ? [kind] : ['base', kind])
        for (const file of await readdir(join(STARTERS, dir)))
          names.set(file, await readFile(join(STARTERS, dir, file), 'utf8'));
      const partials = [...names.keys()].map((n) => n.replace(/\.html$/, ''));
      for (const [file, text] of names) {
        if (!AppCodeCheck.isTemplate(file)) continue;
        const found = scan(text, partials);
        assert.deepEqual(found.problems, [], `${kind}/${file}`);
        const unknown = [...found.names].filter((n) => !AppCodeCheck.NAMES.includes(n));
        assert.deepEqual(unknown, [], `${kind}/${file}`);
      }
    }
  });

  test('여닫는 짝 · 없는 조각 · {{{ }}}는 html에만 · 구분자 바꾸기 · 닫히지 않은 태그를 줄과 함께 알린다', () => {
    const text = [
      '<h1>{{app.name}}</h1>',
      '{{#posts}}<a href="{{url}}">{{title}}</a>{{/menus}}',
      '{{> header}}{{> nope}}',
      '{{{post.title}}} {{&app.description}} {{{post.html}}} {{#post}}{{{html}}}{{/post}}',
      '{{=<% %>=}} {{! 설명 {{ 은 괜찮다 }}',
      '{{#more}}다음',
      '{{/issues}} {{titel}} {{post.titel}} {{.}}',
      '{{ app.url',
    ].join('\n');
    const found = scan(text, ['header']);
    assert.deepEqual(found.problems, [
      '2: 2줄의 {{#posts}}을 {{/menus}}로 닫았어요',
      '3: 없는 조각 {{> nope}} (nope.html이 없어요)',
      '4: {{{post.title}}}는 글자를 그대로 넣어요. html 값(post.html)에만 쓰고 나머지는 {{post.title}}로',
      '4: {{{app.description}}}는 글자를 그대로 넣어요. html 값(post.html)에만 쓰고 나머지는 {{app.description}}로',
      '5: 구분자 바꾸기({{= =}})는 쓰지 않아요',
      '7: 6줄의 {{#more}}을 {{/issues}}로 닫았어요',
      '8: 닫히지 않은 {{',
    ]);
    assert.deepEqual(
      [...found.names].filter((n) => !AppCodeCheck.NAMES.includes(n)),
      ['titel'],
      '점 앞의 첫 마디만 본다 (post.titel은 post로)',
    );
    assert.deepEqual(scan('{{#posts}}{{title}}').problems, [
      '1: {{#posts}}을 닫지 않았어요 ({{/posts}})',
    ]);
    assert.deepEqual(scan('{{/posts}}').problems, ['1: 열지 않은 {{/posts}}']);
    assert.deepEqual(scan('{{ }}').problems, ['1: 이름이 빈 태그']);
  });
});

describe('앱 코드 검사 (AppCodeCheck.checks)', () => {
  const starter = codeOf([
    { name: 'index.html', size: 300, text: '{{> header}}{{#posts}}{{title}}{{/posts}}' },
    { name: 'header.html', size: 100, text: '<a href="{{base}}">{{app.name}}</a>' },
    { name: 'style.css', size: 2000, text: 'body{}' },
    { name: 'logo.png', size: 5000, text: null },
  ]);

  test('받은 코드 위에 낸 파일을 얹어 본다: 낸 템플릿만 훑고, 조각은 받은 코드에서도 찾는다', () => {
    const made = [
      new AppCodeEntry('post.html', 120, '{{> header}}<h1>{{post.title}}</h1>{{{post.html}}}'),
      new AppCodeEntry('style.css', 2400, null),
    ];
    assert.deepEqual(short(AppCodeCheck.checks(starter, made)), [
      [AppCodeCheck.BUNDLE, true, '5개 · 8KB'],
      [AppCodeCheck.SYNTAX, true, '1개'],
      [AppCodeCheck.DATA, true, '모두 약속에 있음'],
    ]);
    assert.deepEqual(
      AppCodeCheck.checks(starter, []),
      [],
      '낸 것이 없으면 결과물 파일 검사만 떨어진다',
    );
    assert.deepEqual(
      short(AppCodeCheck.checks(starter, [new AppCodeEntry('app.js', 10, null)])),
      [[AppCodeCheck.BUNDLE, true, '5개 · 7KB']],
      '템플릿을 내지 않으면 문법 · 이름 검사는 없다',
    );
  });

  test('묶음 규칙: index.html · 개수 · 크기 · cairn.json. 묶음과 문법만 일을 실패로 끝낸다', () => {
    const empty = codeOf([]);
    const noEntry = AppCodeCheck.checks(empty, [new AppCodeEntry('style.css', 10, null)]);
    assert.deepEqual(short(noEntry), [[AppCodeCheck.BUNDLE, false, '문제 1개']]);
    assert.match(noEntry[0]?.tail ?? '', /index\.html가 없어요/);

    const many = Array.from({ length: 101 }, (_, i) => new AppCodeEntry(`f${i}.css`, 1, null));
    const big = new AppCodeEntry('index.html', 2 * 1024 * 1024, null);
    const tail = AppCodeCheck.checks(empty, [...many, big])[0]?.tail ?? '';
    assert.match(tail, /100개까지예요 \(모두 102개\)/);
    assert.match(tail, /템플릿\(\.html\)은 합쳐 1MB까지/);

    const manifest = (text: string | null) =>
      AppCodeCheck.checks(starter, [new AppCodeEntry('cairn.json', 40, text)])[0]?.tail ?? '';
    assert.equal(manifest('{"cairn":1,"hosts":["fonts.example.com"]}'), '');
    assert.match(
      manifest('{"cairn":1,"hosts":["*.example.com","10.0.0.1","a.com:443"]}'),
      /와일드카드/,
    );
    assert.equal(
      manifest('{"cairn":1,"hosts":["*.example.com","10.0.0.1"]}').split('\n').length,
      2,
    );
    assert.match(
      manifest('{"cairn":1,"hosts":["dapi.kakao.com"]}'),
      /지도는 cairn\.map으로/,
      '지도 회사의 스크립트를 직접 넣지 않는다 (2026-11-25)',
    );
    // 거절하는 호스트는 지도 플러그인의 회사 목록(providers.json의 sdkHosts) 전부다 (docs/지도.md MP-1)
    for (const host of mapSdkHosts())
      assert.match(manifest(JSON.stringify({ cairn: 1, hosts: [host] })), /cairn\.map/, host);
    assert.equal(
      manifest('{"cairn":1,"hosts":["fonts.googleapis.com"]}'),
      '',
      '글꼴은 막지 않는다',
    );
    assert.match(manifest('{"cairn":2}'), /데이터 약속\(cairn\)은 1/);
    assert.match(manifest('nope'), /JSON이 아니에요/);
    assert.match(manifest(null), /읽지 못했어요/);

    const typo = AppCodeCheck.checks(starter, [new AppCodeEntry('list.html', 20, '{{titel}}')]);
    assert.deepEqual(short(typo).at(-1), [AppCodeCheck.DATA, false, '문제 1개']);
    assert.match(typo.at(-1)?.tail ?? '', /- list\.html: titel/);
    assert.equal(AppCodeCheck.fatal(typo), null, '모르는 이름은 알리기만 한다');
    const broken = AppCodeCheck.checks(starter, [new AppCodeEntry('list.html', 20, '{{#posts}}')]);
    assert.equal(AppCodeCheck.fatal(broken)?.name, AppCodeCheck.SYNTAX);
    assert.equal(AppCodeCheck.fatal(noEntry)?.name, AppCodeCheck.BUNDLE);
  });
});

// 정적 앱 (스토어 9.13): cairn.json에 "render": "static"이면 HTML이 템플릿이 아니라 그대로 나간다. 폴더가 든 결과는 app.zip 하나로 낸다
describe('정적 앱 검사 (AppCodeCheck.checks · packed)', () => {
  const STATIC = '{"cairn":1,"render":"static"}';
  const page = (files: object[]) =>
    AppCodeBase.from(
      Json.of({
        app_id: id(2),
        name: '동네 지도',
        kind: 'page',
        slug: 'map',
        seq: 1,
        files,
        hosts: [],
      }),
    ) as AppCodeBase;
  const tail = (checks: readonly StageCheck[]) => checks[0]?.tail ?? '';

  test('정적 앱의 HTML은 템플릿으로 보지 않는다. 어느 종류의 앱이든, 폴더는 정적 앱만', () => {
    const empty = page([]);
    const made = [
      new AppCodeEntry('index.html', 200, '<div id="app">{{ count }}</div>{{#broken'),
      new AppCodeEntry('app.js', 900, null),
      new AppCodeEntry('cairn.json', 30, STATIC),
    ];
    assert.deepEqual(short(AppCodeCheck.checks(empty, made)), [
      [AppCodeCheck.BUNDLE, true, '3개 · 1KB'],
    ]);
    // 앞 버전이 정적 앱이면 cairn.json을 다시 내지 않아도 정적 앱이다
    const before = page([{ name: 'cairn.json', size: 30, text: STATIC }]);
    const again = AppCodeCheck.checks(before, [new AppCodeEntry('index.html', 10, '{{#x')]);
    assert.deepEqual(short(again), [[AppCodeCheck.BUNDLE, true, '2개 · 40B']]);

    assert.equal(AppCodeCheck.checks(codeOf([]), made)[0]?.ok, true, '블로그 앱도 정적 앱이 된다');
    assert.match(
      tail(AppCodeCheck.checks(empty, [new AppCodeEntry('cairn.json', 20, '{"render":"server"}')])),
      /render\)은 template · static/,
    );
  });

  test('선언서의 회원 · 권한 · 테마 · 표를 서버와 같은 규칙으로 본다 (앱 플랫폼, 스토어 12.1)', () => {
    const empty = page([]);
    const withManifest = (manifest: object, extra: AppCodeEntry[] = []) =>
      AppCodeCheck.checks(empty, [
        new AppCodeEntry('index.html', 100, '<div id="app"></div>'),
        new AppCodeEntry(
          'cairn.json',
          200,
          JSON.stringify({ cairn: 1, render: 'static', ...manifest }),
        ),
        ...extra,
      ]);
    const good = withManifest(
      {
        members: true,
        permissions: ['microphone'],
        theme: { accent: '#58cc02', logo: 'logo.svg' },
        tables: {
          progress: { columns: { lesson: 'text', xp: 'int' }, read: 'owner', write: 'owner' },
          words: { columns: { word: 'text', meta: 'json' }, read: 'anyone', write: 'admin' },
        },
      },
      [new AppCodeEntry('logo.svg', 300, null)],
    );
    assert.deepEqual(short(good), [[AppCodeCheck.BUNDLE, true, '3개 · 600B']]);

    const bad = withManifest({
      members: 'yes',
      permissions: ['bluetooth'],
      theme: { accent: 'green', logo: 'none.svg' },
      tables: {
        Progress: { columns: { a: 'text' }, read: 'anyone', write: 'admin' },
        scores: { columns: { id: 'int', when: 'date' }, read: 'everyone', write: 'owner' },
      },
    });
    const lines = tail(bad);
    for (const pattern of [
      /회원\(members\)은 true · false/,
      /권한\(permissions\)은 microphone · camera · geolocation/,
      /테마의 색\(accent\)은 #rrggbb/,
      /로고 파일이 묶음에 없어요: none\.svg/,
      /표 이름은 영문 소문자로 시작하는.*Progress/,
      /쓸 수 없는 칸 이름이에요: scores\.id/,
      /칸의 타입은 text · int · number · bool · time · json 중 하나예요: scores\.when/,
      /표 scores의 읽기 규칙\(read\)/,
      /표 scores의 규칙\(member · owner\)은 회원이 있는 앱에서만/,
    ])
      assert.match(lines, pattern);
    assert.equal(AppCodeCheck.fatal(bad)?.name, AppCodeCheck.BUNDLE);

    // 커뮤니티 앱은 늘 회원이 있다: members 없이도 회원 규칙을 쓴다
    const community = AppCodeBase.from(
      Json.of({
        app_id: id(3),
        name: '모임',
        kind: 'community',
        slug: 'club',
        seq: 1,
        files: [],
        hosts: [],
      }),
    ) as AppCodeBase;
    const club = AppCodeCheck.checks(community, [
      new AppCodeEntry('index.html', 100, '<div id="app"></div>'),
      new AppCodeEntry(
        'cairn.json',
        100,
        JSON.stringify({
          render: 'static',
          tables: { likes: { columns: { topic: 'text' }, read: 'member', write: 'owner' } },
        }),
      ),
    ]);
    assert.deepEqual(short(club), [[AppCodeCheck.BUNDLE, true, '2개 · 200B']]);
  });

  test('app.zip은 묶음 전체다: 정적 앱이어야 하고, 폴더 · 이름 · 개수 규칙을 본다. 받지 못한 파일은 남는다', () => {
    const before = page([
      { name: 'index.html', size: 100, text: '<p>옛 화면</p>' },
      { name: 'assets/photo.png', size: 4000, text: null },
      { name: 'old.js', size: 50, text: 'x' },
      { name: 'cairn.json', size: 30, text: STATIC },
    ]);
    const inside = [
      new AppCodeEntry('index.html', 300, null),
      new AppCodeEntry('assets/app.js', 2000, null),
      new AppCodeEntry('about/index.html', 100, null),
      new AppCodeEntry('cairn.json', 30, STATIC),
    ];
    // zip의 4개 + 내용을 받지 못한 그림 1개 (글로 받은 old.js는 zip에 없으면 사라진다)
    assert.deepEqual(short(AppCodeCheck.packed(before, inside)), [
      [AppCodeCheck.BUNDLE, true, '5개 · 6KB'],
    ]);

    const plain = AppCodeCheck.packed(before, [new AppCodeEntry('index.html', 10, null)]);
    assert.match(tail(plain), /zip 안의 cairn\.json에 "render": "static"/);
    assert.equal(AppCodeCheck.fatal(plain)?.name, AppCodeCheck.BUNDLE);
    assert.match(tail(AppCodeCheck.packed(before, null)), /app\.zip을 읽지 못했어요/);
    const deep = new AppCodeEntry('a/b/c/d/e/f/g.js', 1, null);
    assert.match(
      tail(AppCodeCheck.packed(before, [...inside, deep])),
      /쓸 수 없는 이름이에요: a\/b/,
    );
    const hidden = new AppCodeEntry('assets/.env', 1, null);
    assert.match(tail(AppCodeCheck.packed(before, [...inside, hidden])), /assets\/\.env/);
    const noEntry = inside.filter((f) => f.name !== 'index.html');
    assert.match(
      tail(AppCodeCheck.packed(before, noEntry)),
      /index\.html가 없어요 \(앱의 첫 화면\)/,
    );
    const many = Array.from({ length: 500 }, (_, i) => new AppCodeEntry(`f/${i}.js`, 1, null));
    assert.match(tail(AppCodeCheck.packed(before, [...inside, ...many])), /500개까지예요/);
    // 템플릿 앱에 폴더를 내면 정적 앱으로 만들라고 알린다
    const nested = AppCodeCheck.checks(codeOf([{ name: 'index.html', size: 1, text: 'x' }]), [
      new AppCodeEntry('assets/app.js', 1, null),
    ]);
    assert.match(tail(nested), /폴더는 정적 앱만 써요: assets\/app\.js/);
  });

  test('zip의 목록 읽기 (ZipIndex): 감싼 폴더를 벗기고, 운영체제 파일은 건너뛰고, cairn.json은 내용까지', () => {
    const files = {
      'dist/index.html': '<p>지도</p>',
      'dist/assets/app.js': 'console.log(1)'.repeat(200),
      'dist/cairn.json': STATIC,
      'dist/.DS_Store': 'x',
    };
    const index = ZipIndex.read(zipOf(files));
    assert.equal(
      ZipIndex.read(zipOf(files, false))?.text('cairn.json', 100),
      STATIC,
      '줄이지 않은 zip',
    );
    assert.ok(index);
    assert.deepEqual(
      index.entries.map((e) => [e.name, e.size]),
      [
        ['index.html', 13],
        ['assets/app.js', 2800],
        ['cairn.json', STATIC.length],
      ],
    );
    assert.equal(index.text('cairn.json', 16 * 1024), STATIC);
    assert.equal(index.text('assets/app.js', 100), null, '한도를 넘으면 풀지 않는다');
    assert.equal(index.text('none.txt', 100), null);
    assert.equal(ZipIndex.read(Buffer.from('zip이 아닌 글')), null);
    assert.equal(ZipIndex.read(Buffer.alloc(0)), null);
  });

  test('폴더가 든 앞 코드는 폴더째 inputs/app/에 둔다. 바깥을 가리키는 이름은 버린다', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cairn-app-static-'));
    try {
      const code = page([
        { name: 'index.html', size: 10, text: '<p>지도</p>' },
        { name: 'assets/lib/util.js', size: 10, text: 'export {}' },
        { name: 'assets/photo.png', size: 4000, text: null },
        { name: '../outside.js', size: 1, text: 'x' },
        { name: 'assets/../../up.js', size: 1, text: 'x' },
        { name: '/abs.js', size: 1, text: 'x' },
      ]);
      assert.deepEqual(
        code.files.map((f) => f.name),
        ['index.html', 'assets/lib/util.js', 'assets/photo.png'],
      );
      const into = await code.writeTo(dir);
      assert.equal(await readFile(join(into, 'assets/lib/util.js'), 'utf8'), 'export {}');
      assert.deepEqual((await readdir(dir)).sort(), ['app']);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('앱 코드 일 (MakeStage)', () => {
  const job = (payload: object) =>
    Job.from(
      Json.of({
        task: { id: id(70), kind: 'make', title: '블로그 꾸미기', payload },
        agent: { name: '만들기', role: '', tool: 'claude' },
        instruction: '글 목록을 카드로',
        run_token: 'cairn_run_x',
      }),
    );

  test('payload.appCode가 있는 make 일만 앱 코드 일이다', () => {
    assert.equal(job({ appCode: { appId: id(1) } }).appCode, true);
    assert.equal(job({ make: { outputs: [] } }).appCode, false);
    assert.equal(job({ appCode: { appId: id(1) } }).withBrief('# 고칠 앱').appCode, true);
  });

  test('지금 코드를 inputs/app/에 두고 지시 단락을 채우고, 검사가 그래도 틀리면 실패로 끝낸다', async () => {
    const work = await mkdtemp(join(tmpdir(), 'cairn-app-code-'));
    const code = codeOf(
      [
        { name: 'index.html', size: 40, text: '{{> header}}{{#posts}}{{title}}{{/posts}}' },
        { name: 'header.html', size: 30, text: '<a href="{{base}}">{{app.name}}</a>' },
        { name: 'icon.svg', size: 300, text: '<svg/>' },
        { name: 'photo.jpg', size: 9000, text: null },
      ],
      ['fonts.example.com'],
    );
    const config = new RunnerConfig(
      'http://cairn',
      'device',
      {},
      {},
      '/없는',
      null,
      null,
      '1',
      AgentUser.parse('self'),
      work,
    );
    const server = { appCodeBase: async () => code } as unknown as CairnServer;
    const redactor = new Redactor([]);
    const agent = AgentUser.parse('self') as AgentUser;
    const stage = new MakeStage(
      job({ appCode: { appId: id(1) } }),
      config,
      agent,
      new RunLog(redactor),
      server,
    );
    const notes: string[] = [];
    try {
      const ending = await stage.prepare(
        new AbortController().signal,
        (e) => notes.push(e.body),
        redactor,
      );
      assert.equal(ending, null);
      assert.deepEqual(notes, ['고칠 앱 코드(시작 코드)를 받았어요']);
      const room = stage.workspaceRoom;
      assert.ok(room);
      const dir = join(room.inputsDir, 'app');
      assert.deepEqual((await readdir(dir)).sort(), ['header.html', 'icon.svg', 'index.html']);

      const pack = PromptPack.read(resolve(__dirname, '../../../skills'));
      const prompt = stage.aiJob(pack).brief ?? '';
      assert.match(prompt, /# 고칠 앱: 개발 블로그 \(blog · 지금 시작 코드\)/);
      assert.match(
        prompt,
        new RegExp(`글 파일은 ${dir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}에 있어요`),
      );
      assert.match(prompt, /- photo\.jpg \(그대로 남아요/);
      assert.match(prompt, /\(지금: fonts\.example\.com\)/);
      assert.doesNotMatch(prompt, /# 재료/);

      await writeFile(join(room.outputsDir, 'list.html'), '{{#posts}}<b>{{title}}</b>');
      const checks = await stage.check();
      assert.deepEqual(short(checks), [
        ['결과물 파일', true, '1개'],
        [AppCodeCheck.BUNDLE, true, '5개 · 9KB'],
        [AppCodeCheck.SYNTAX, false, '문제 1개'],
        [AppCodeCheck.DATA, true, '모두 약속에 있음'],
      ]);
      const failed = await stage.finish(
        '고쳤어요',
        checks,
        new AbortController().signal,
        () => {},
        redactor,
      );
      assert.match(failed.note, /템플릿 문법 검사에 떨어져 새 버전을 만들지 않았어요/);

      await writeFile(join(room.outputsDir, 'list.html'), '{{#posts}}<b>{{title}}</b>{{/posts}}');
      // 화면을 낸 앱 코드 일은 디자인 문서도 낸다 (2026-11-25)
      await writeFile(
        join(room.outputsDir, 'design.md'),
        '## 한 줄\n블로그\n## 참고한 곳\n- https://a.example/\n- https://b.example/\n## 방향\n조용함\n## 토큰\n:root {}',
      );
      const fixed = await stage.check();
      assert.equal(
        fixed.every((c) => c.ok),
        true,
      );
      const done = await stage.finish(
        '고쳤어요',
        fixed,
        new AbortController().signal,
        () => {},
        redactor,
      );
      assert.equal(done.note, '만들었어요');

      // app.zip을 내면 zip 안을 묶음 전체로 본다 (블로그 앱도 정적 앱이 된다, 2026-11-25 A4)
      const zip = zipOf({
        'index.html': '<p>지도</p>',
        'assets/app.js': 'console.log(1)',
        'cairn.json': '{"cairn":1,"render":"static"}',
      });
      await writeFile(join(room.outputsDir, 'app.zip'), zip);
      const packed = await stage.check();
      const bundle = packed.find((c) => c.name === AppCodeCheck.BUNDLE);
      assert.equal(bundle?.ok, true, bundle?.tail);
      // zip 안이 묶음 전체라 디자인 문서도 zip 안에 있어야 한다
      assert.match(
        packed.find((c) => c.name === DesignDocCheck.NAME)?.tail ?? '',
        /design\.md가 없어요/,
      );
      await writeFile(join(room.outputsDir, 'app.zip'), 'zip이 아닌 글');
      assert.match((await stage.check()).at(-1)?.tail ?? '', /app\.zip을 읽지 못했어요/);
    } finally {
      await stage.close();
      await rm(work, { recursive: true, force: true });
    }
  });
});
