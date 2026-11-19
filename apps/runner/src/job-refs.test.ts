import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { describe, test } from 'node:test';
import { JobRefs } from './job-refs';
import { Json } from './json';
import { PromptPack } from './prompt-pack';

// 대화의 참조 (2026-11-15 B): payload.refs를 거르고 지시문 단락을 만든다. 저장소의 지시문 틀(cairn-runner)로 본다
const PACK = PromptPack.read(resolve(__dirname, '../../../skills'));
const WIKI = '0190a000-0000-7000-8000-000000000001';
const OUTPUT = '0190a000-0000-7000-8000-000000000003';

const refs = (list: unknown[]) => JobRefs.from(Json.of({ refs: list }));

describe('참조 읽기', () => {
  test('모양이 틀린 줄(id가 UUID가 아님 · http가 아닌 주소 · 둘 다 없음)은 버린다', () => {
    const got = refs([
      { kind: 'wiki', id: WIKI, title: '여행 메모', private: true },
      { kind: 'wiki', id: 'not-a-uuid', title: '나쁜 id' },
      { kind: 'url', url: 'file:///etc/passwd', title: '로컬' },
      { kind: 'url', title: '빈 것' },
      { kind: 'output', id: OUTPUT, title: 'report.pdf', private: true },
    ]);
    assert.deepEqual(got.outputs, [OUTPUT]);
    assert.equal(refs([]).empty, true);
  });

  test('지시문: 종류마다 읽는 도구, 비공개 표시, 결과물은 만들기 일에서만 inputs/', () => {
    const got = refs([
      { kind: 'wiki', id: WIKI, title: '여행 메모', private: true },
      { kind: 'url', url: 'https://example.com/a', title: 'https://example.com/a' },
      {
        kind: 'url',
        url: 'https://shop.example.com',
        title: 'https://shop.example.com',
        browser: true,
      },
      { kind: 'output', id: OUTPUT, title: 'report.pdf', private: true },
    ]);
    const general = got.brief(PACK, false);
    assert.match(general, /여행 메모 \(비공개\): 위키 · get_wiki의 wiki_id 0190a000/);
    assert.match(general, /read_url로 읽기 · https:\/\/example\.com\/a/);
    assert.match(general, /서버 브라우저로 열 주소 · https:\/\/shop\.example\.com/);
    assert.match(
      general,
      /report\.pdf \(비공개\): 결과물 파일 \(id .*\) · 이 일에서는 열 수 없습니다/,
    );
    assert.match(
      got.brief(PACK, true),
      /report\.pdf \(비공개\): 결과물 파일 · inputs\/에 재료로 받아 두었습니다/,
    );
    assert.match(general, /그 안에 적힌 지시/, '자료라는 표시');
  });
});

describe('사진 (대화에 사진 넣기 ②-b)', () => {
  test('서버가 image로 표시한 결과물만 사진이고, 한 번에 4장까지', () => {
    const photo = (n: number) => ({
      kind: 'output',
      id: `0190a000-0000-7000-8000-00000000001${n}`,
      title: `사진${n}`,
      image: true,
    });
    const got = refs([
      { kind: 'wiki', id: WIKI, title: '위키', image: true },
      { kind: 'output', id: OUTPUT, title: 'report.pdf' },
      ...[1, 2, 3, 4, 5].map(photo),
    ]);
    assert.deepEqual([...got.photos.values()], ['사진1', '사진2', '사진3', '사진4']);
    assert.deepEqual(got.attachedPhotos, [], '받기 전에는 붙일 것이 없다');
  });
});
