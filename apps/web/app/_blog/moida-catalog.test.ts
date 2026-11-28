import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { LIBRARY, libraryMarkdown, moidaTypes } from './moida-catalog.ts';
import { UI_ACCOUNT } from './moida-ui-account.ts';
import { UI_BASE } from './moida-ui-base.ts';
import { UI_PLACES } from './moida-ui-places.ts';

// 앱 라이브러리의 목록 (2026-11-28): 스킬 참고 library.md · 플러그인 목록 파일의 client.provides가 목록과 어긋나지 않는지,
// 화면 부품 글자가 브라우저에서 읽히는 스크립트인지

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const LIBRARY_MD = join(ROOT, 'skills/moida-make/references/library.md');

describe('앱 라이브러리 목록', () => {
  test('skills/moida-make/references/library.md는 목록에서 만든 그대로다', () => {
    if (process.env.MOIDA_WRITE_LIBRARY === '1') writeFileSync(LIBRARY_MD, libraryMarkdown());
    assert.equal(
      readFileSync(LIBRARY_MD, 'utf8'),
      libraryMarkdown(),
      'apps/web에서 pnpm library로 다시 만드세요',
    );
  });

  test('플러그인이 준다고 적은 것(client.provides)과 목록의 plugin이 같다', () => {
    const declared = new Set<string>();
    for (const name of readdirSync(join(ROOT, 'plugins'))) {
      const file = join(ROOT, 'plugins', name, 'moida-plugin.json');
      if (!existsSync(file)) continue;
      const manifest = JSON.parse(readFileSync(file, 'utf8')) as {
        client?: { provides?: string[] };
      };
      for (const p of manifest.client?.provides ?? []) {
        assert.equal(LIBRARY.find((e) => e.name === p)?.plugin, name, `${name}의 ${p}`);
        declared.add(p);
      }
    }
    for (const e of LIBRARY.filter((x) => x.plugin !== null))
      assert.ok(declared.has(e.name), `${e.name}을 플러그인 ${e.plugin}의 client.provides에 적기`);
  });

  test('이름은 겹치지 않고, 부품은 <moida-…>, 스크립트는 moida.…', () => {
    assert.equal(new Set(LIBRARY.map((e) => e.name)).size, LIBRARY.length);
    for (const e of LIBRARY)
      assert.match(e.name, e.group === 'component' ? /^<moida-[a-z-]+>$/ : /^moida\.[a-z]+$/i);
  });

  test('moida.d.ts에 부품 태그와 window.moida가 있다', () => {
    const types = moidaTypes();
    assert.match(types, /interface Window \{\n {2}moida: Moida;/);
    assert.match(types, /'moida-place-list': MoidaPlaceListElement;/);
    assert.match(types, /from\(table: string\): MoidaQuery;/);
  });
});

describe('화면 부품', () => {
  const script = `(() => {${UI_BASE}${UI_PLACES}${UI_ACCOUNT}})();`;

  test('부품 글자는 브라우저 스크립트로 읽힌다', () => {
    assert.doesNotThrow(() => new vm.Script(script));
  });

  test('목록에 적은 부품은 모두 정의한다', () => {
    for (const e of LIBRARY.filter((x) => x.group === 'component'))
      assert.ok(script.includes(`define('${e.name.slice(1, -1)}'`), e.name);
  });

  test('값은 늘 글자로 넣는다 (innerHTML을 쓰지 않는다)', () => {
    assert.doesNotMatch(script, /innerHTML|insertAdjacentHTML|outerHTML/);
  });
});
