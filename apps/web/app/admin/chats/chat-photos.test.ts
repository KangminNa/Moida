import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pickPhotos } from './chat-photos.ts';

// 대화에 넣는 사진의 규칙 (대화에 사진 넣기 ②-c): 형식 · 크기 · 한 메시지에 4장
const photo = (name: string, type = 'image/png', size = 1024) =>
  new File([new Uint8Array(size)], name, { type });

test('PNG · JPEG · WebP · GIF만, 장당 10MB까지 넣는다', () => {
  const kinds = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
  const all = pickPhotos(
    kinds.map((type, i) => photo(`${i}`, type)),
    0,
  );
  assert.equal(all.photos.length, 4);
  assert.equal(all.problem, null);

  const svg = pickPhotos([photo('도형.svg', 'image/svg+xml'), photo('a.png')], 0);
  assert.deepEqual(
    svg.photos.map((f) => f.name),
    ['a.png'],
  );
  assert.equal(svg.problem, 'PNG · JPEG · WebP · GIF 사진만 넣어요');

  const big = pickPhotos([photo('큰.png', 'image/png', 10 * 1024 * 1024 + 1)], 0);
  assert.deepEqual(big.photos, []);
  assert.equal(big.problem, '10MB가 넘는 사진은 넣지 못해요');
});

test('이미 넣은 사진과 합쳐 4장까지', () => {
  const three = [photo('1.png'), photo('2.png'), photo('3.png')];
  const got = pickPhotos(three, 2);
  assert.deepEqual(
    got.photos.map((f) => f.name),
    ['1.png', '2.png'],
  );
  assert.equal(got.problem, '사진은 한 번에 4장까지예요');
  assert.deepEqual(pickPhotos(three, 4).photos, []);
});
