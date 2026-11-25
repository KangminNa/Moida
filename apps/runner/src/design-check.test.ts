import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, test } from 'node:test';
import { AppCodeEntry } from './app-code-check';
import { DesignCheck } from './design-check';

// 디자인 기준 검사 (2026-11-24, 스킬 cairn-make의 references/design.md 6장)

const file = (name: string, text: string) => new AppCodeEntry(name, text.length, text);
const GOOD_HEAD =
  '<!doctype html><html lang="ko"><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><img src="a.png" alt=""></body></html>';
const GOOD_CSS = `:root { --bg: #ffffff; --fg: #17181c; --muted: #5b5f69; --accent: #2563eb; --accent-fg: #fff; }
@media (prefers-color-scheme: dark) { :root { --bg: #111214; --fg: #ededf0; } }
a:focus-visible { outline: 2px solid var(--accent); }
button { outline: none; font-size: 0.875rem; }`;

describe('디자인 기준 검사', () => {
  test('기준에 맞으면 통과, 낸 HTML · CSS가 없으면 보지 않는다', () => {
    const made = [file('index.html', GOOD_HEAD), file('style.css', GOOD_CSS)];
    const check = DesignCheck.check(made, made);
    assert.equal(check?.ok, true, check?.tail);
    assert.equal(DesignCheck.check([file('cairn.json', '{}')], []), null);
  });

  test('스킬의 토큰 본보기(3장)는 밝은 · 어두운 화면 모두 대비 4.5:1을 넘는다 (문서와 검사가 어긋나지 않게)', () => {
    const doc = readFileSync(
      resolve(__dirname, '../../../skills/cairn-make/references/design.md'),
      'utf8',
    );
    const css = /```css\n([\s\S]*?)```/.exec(doc)?.[1] ?? '';
    assert.match(css, /--accent-fg/);
    const check = DesignCheck.check([file('style.css', css)], []);
    assert.equal(check?.ok, true, check?.tail);
  });

  test('어긋난 것을 고칠 줄로 알려 준다', () => {
    const page =
      '<html><head><meta name="viewport" content="width=device-width, maximum-scale=1"></head><img src="x.png"></html>';
    const css = `:root { --bg: #ffffff; --fg: #bbbbbb; }
.note { font-size: 10px; }
button { outline: 0; }
.pop { animation: spin 1s infinite; } @keyframes spin {}`;
    const check = DesignCheck.check([file('index.html', page), file('style.css', css)], []);
    assert.equal(check?.ok, false);
    for (const want of [
      /--fg #bbbbbb \/ --bg #ffffff의 대비가 1\.\d+:1/,
      /확대를 막지 않아요/,
      /lang="ko"가 없어요/,
      /alt가 없는 <img>/,
      /font-size 10px/,
      /:focus-visible/,
      /prefers-reduced-motion/,
    ])
      assert.match(check?.tail ?? '', want);
  });

  test('viewport는 <head>를 쓴 화면만, 화면 전체에서 찾는다 (머리 조각에 있으면 통과)', () => {
    const head = file(
      'head.html',
      '<meta name="viewport" content="width=device-width, initial-scale=1">',
    );
    const body = file('index.html', '<html lang="ko"><head>{{> head}}</head><p>안녕</p></html>');
    assert.equal(DesignCheck.check([body], [head, body])?.ok, true);
    const alone = DesignCheck.check([body], [body]);
    assert.match(alone?.tail ?? '', /viewport 메타가 없어요/);
    // 조각만 고친 일은 묻지 않는다 (머리는 앞 코드의 조각에 있다)
    const part = file('list.html', '{{#posts}}<b>{{title}}</b>{{/posts}}');
    assert.equal(DesignCheck.check([part], [])?.ok, true);
  });

  test('대비는 WCAG 값과 같다', () => {
    assert.equal(DesignCheck.ratio('#000', '#fff').toFixed(1), '21.0');
    assert.equal(DesignCheck.ratio('#767676', '#ffffff').toFixed(2), '4.54');
  });
});
