import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { AppCodeEntry } from './app-code-check';
import { DesignDocCheck } from './design-doc-check';

// 디자인 문서 검사 (2026-11-25, 스킬 cairn-make의 references/design-research.md)

const DOC = [
  '# 디자인 문서: 동네 빵집',
  '## 한 줄',
  '동네 손님이 오늘 빵을 본다 / 화면: 첫 화면 · 메뉴',
  '## 참고한 곳',
  '- 빵집 하나 · https://bakery-one.example/ · 2026-11-25: 사진이 큰 첫 화면',
  '- 빵집 둘 · https://bakery-two.example/menu · 2026-11-25: 오늘의 빵 목록',
  '## 방향',
  '따뜻한 종이 느낌.',
  '## 토큰',
  ':root { --bg: #fffaf4; }',
].join('\n');
const entry = (name: string, text: string | null = '') =>
  new AppCodeEntry(name, text?.length ?? 0, text);
const screen = [entry('index.html', '<main></main>')];

describe('디자인 문서 검사', () => {
  test('화면을 내지 않은 일은 보지 않는다', () => {
    assert.equal(DesignDocCheck.check([entry('cairn.json', '{}')], []), null);
  });

  test('문서가 있고 제목 넷 · 참고 주소 둘이면 통과 (앞 버전의 문서도 된다)', () => {
    const made = DesignDocCheck.check(screen, [...screen, entry('design.md', DOC)]);
    assert.equal(made?.ok, true);
    const kept = DesignDocCheck.check(screen, [entry('design.md', DOC), ...screen]);
    assert.equal(kept?.ok, true);
  });

  test('없거나 · 제목이 빠졌거나 · 참고 주소가 하나면 고칠 점을 알린다', () => {
    const missing = DesignDocCheck.check(screen, screen);
    assert.equal(missing?.ok, false);
    assert.match(String(missing?.tail), /design\.md가 없어요/);

    const noTokens = DOC.replace('## 토큰', '## 색');
    assert.match(
      String(DesignDocCheck.check(screen, [...screen, entry('design.md', noTokens)])?.tail),
      /"토큰" 제목\(## 토큰\)이 없어요/,
    );

    const oneLink = DOC.replace('https://bakery-two.example/menu', '빵집 둘의 주소');
    const one = DesignDocCheck.check(screen, [...screen, entry('design.md', oneLink)]);
    assert.equal(one?.ok, false);
    assert.match(String(one?.tail), /2개 이상.*지금 1개/);

    // "참고한 곳" 밖의 주소는 세지 않는다
    const elsewhere = `${oneLink}\n- 다른 곳 https://elsewhere.example/`;
    assert.equal(
      DesignDocCheck.check(screen, [...screen, entry('design.md', elsewhere)])?.ok,
      false,
    );
    assert.match(
      String(DesignDocCheck.check(screen, [...screen, entry('design.md', null)])?.tail),
      /읽지 못했어요/,
    );
  });
});
