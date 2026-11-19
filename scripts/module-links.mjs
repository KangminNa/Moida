// 모듈 사이 이음 검사 (check-boundaries.mjs의 7 · 9 · 10번과 --graph). import 없이 실행할 때 생기는 모듈 사이 의존을
// apps/server/modules.json의 lookups · registries와 코드에서 찾은 것으로 맞춰 본다 (docs/객체설계.md 9장).
import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * 모듈 사이를 잇는 platform의 등록부: 등록부 → 메서드 → [주는지 묻는지, 이음의 이름] (null은 이음이 아닌 메서드).
 * 플랫폼만 쓰는 등록(알림 종류 · 보관함 · 파일 쓰임 · 보관 형식 · 이벤트 받기)은 모듈 사이 의존이 아니라 넣지 않는다.
 * 새 등록부를 만들면 여기에 메서드를 적는다: 적지 않은 메서드를 부르면 막는다
 */
const REGISTRIES = {
  AgentDirectory: {
    register: ['provides', 'agents'],
    find: ['asks', 'agents'],
    registerTeamMaker: ['provides', 'teams'],
    teamFor: ['asks', 'teams'],
  },
  ActionChecks: { register: ['provides', 'action-checks'], problemsOf: ['asks', 'action-checks'] },
  Leases: {
    register: ['provides', 'leases'],
    of: ['asks', 'leases'],
    registerRecord: ['provides', 'run-records'],
    forRecord: ['asks', 'run-records'],
  },
  SettingKinds: {
    register: ['provides', 'settings'],
    of: ['asks', 'settings'],
    listed: ['asks', 'settings'],
    all: ['asks', 'settings'],
  },
  HostGate: {
    registerApps: ['provides', 'app-hosts'],
    registerSite: ['provides', 'site'],
    siteHost: ['asks', 'site'],
    siteOrigin: ['asks', 'site'],
    stale: null,
    openPaths: null,
  },
};

const empty = () => ({ provides: new Set(), asks: new Set() });

export class ModuleLinks {
  /** 코드에서 찾은 것: 모듈 → { provides, asks } */
  lookups = new Map();
  registries = new Map();

  constructor(root, map, problems) {
    this.root = root;
    this.map = map;
    this.modules = Object.keys(map.modules);
    this.problems = problems;
  }

  /** 모듈의 파일 하나에서 lookups의 종류와 등록부를 받은 이름(`이름: 등록부`)으로 부른 메서드를 모은다 */
  note(file, owner, text) {
    const lookups = this.lookups.get(owner) ?? empty();
    for (const m of text.matchAll(/lookups\.provide\(\s*'([\w.-]+)'/g)) lookups.provides.add(m[1]);
    for (const m of text.matchAll(/lookups\.(?:visible|assertVisible)\(\s*'([\w.-]+)'/g))
      lookups.asks.add(m[1]);
    this.lookups.set(owner, lookups);
    if (file.endsWith('.test.ts')) return;

    const found = this.registries.get(owner) ?? empty();
    const names = Object.keys(REGISTRIES).join('|');
    for (const [, name, registry] of text.matchAll(
      new RegExp(`\\b(\\w+)\\??:\\s*(${names})\\b`, 'g'),
    ))
      for (const [, method] of text.matchAll(new RegExp(`\\b${name}\\.(\\w+)\\(`, 'g'))) {
        if (!(method in REGISTRIES[registry])) {
          const at = relative(this.root, file);
          this.problems.push(`${at}: ${registry}.${method}는 등록부 표(module-links.mjs)에 없음`);
          continue;
        }
        const link = REGISTRIES[registry][method];
        if (link) found[link[0]].add(link[1]);
      }
    this.registries.set(owner, found);
  }

  /** 7 · 9 · 10번 */
  check(modulesDir) {
    const givers = this.compare('lookups', this.lookups);
    for (const [kind, ms] of givers)
      if (ms.length > 1) this.problems.push(`읽기 '${kind}'를 ${ms.join('와 ')}이 함께 줌`);
    this.compare('registries', this.registries);
    this.checkSchemaList(modulesDir);
  }

  /** 지도의 provides · asks와 코드가 같은지, 묻는 것을 주는 모듈이 있는지. 이음 → 주는 모듈들 */
  compare(field, foundAll) {
    const givers = new Map();
    for (const m of this.modules) {
      const declared = this.map.modules[m][field] ?? {};
      const found = foundAll.get(m) ?? empty();
      for (const key of ['provides', 'asks']) {
        const want = [...(declared[key] ?? [])].sort().join(', ');
        const have = [...found[key]].sort().join(', ');
        if (want !== have)
          this.problems.push(
            `${m}: modules.json의 ${field}.${key}(${want || '없음'})와 코드(${have || '없음'})가 다름`,
          );
      }
      for (const item of declared.provides ?? [])
        givers.set(item, [...(givers.get(item) ?? []), m]);
    }
    for (const m of this.modules)
      for (const item of this.map.modules[m][field]?.asks ?? [])
        if (!givers.has(item))
          this.problems.push(`${m}: '${item}'를 주는 모듈이 없음 (modules.json ${field})`);
    return givers;
  }

  /** platform Database.MODULE_SCHEMAS(서버 이미지에는 modules.json이 없다)와 modules.json의 schemas */
  checkSchemaList(modulesDir) {
    const text = readFileSync(join(modulesDir, 'platform/base/database.ts'), 'utf8');
    const list = /MODULE_SCHEMAS[^=]*=\s*\[([^\]]*)\]/.exec(text)?.[1] ?? '';
    const have = [...list.matchAll(/'(\w+)'/g)]
      .map((m) => m[1])
      .sort()
      .join(', ');
    const want = this.modules
      .flatMap((m) => this.map.modules[m].schemas)
      .sort()
      .join(', ');
    if (have !== want)
      this.problems.push(
        `platform Database.MODULE_SCHEMAS(${have})가 modules.json의 schemas(${want})와 다름`,
      );
  }

  /** 모듈 사이 의존: 가져오기(dependsOn) · 읽기(lookups) · 등록부(registries)로 누가 누구에게 기대는지 */
  printGraph() {
    const providers = (field, item) =>
      this.modules.filter((m) => (this.map.modules[m][field]?.provides ?? []).includes(item));
    console.log('모듈 사이 의존 (묻는 쪽 → 주는 쪽: 무엇으로)');
    for (const m of this.modules) {
      const edges = new Map();
      const add = (to, what) => {
        if (to !== m) edges.set(to, [...(edges.get(to) ?? []), what]);
      };
      const spec = this.map.modules[m];
      for (const d of spec.dependsOn) add(d, 'import');
      for (const kind of spec.lookups?.asks ?? [])
        for (const p of providers('lookups', kind)) add(p, `lookups:${kind}`);
      for (const link of spec.registries?.asks ?? [])
        for (const p of providers('registries', link)) add(p, link);
      for (const [to, what] of edges) console.log(`  ${m} → ${to}: ${what.join(' · ')}`);
    }
  }
}
