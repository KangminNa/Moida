import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { fitSize, SHRINK, shrinkable, shrunkName } from './image-shrink.ts';

// 올리기 전에 사진 줄이기 (2026-11-27): 크기 계산 · 이름 · 줄일 형식 (그리기는 브라우저에서만 된다)

describe('fitSize', () => {
  test('긴 변을 최대에 맞추고 비율을 지킨다', () => {
    assert.deepEqual(fitSize(4032, 3024, SHRINK.photo), { width: 2048, height: 1536 });
    assert.deepEqual(fitSize(3024, 4032, SHRINK.photo), { width: 1536, height: 2048 });
    assert.deepEqual(fitSize(1024, 1024, SHRINK.icon), { width: 512, height: 512 });
  });

  test('작은 사진은 키우지 않는다. 아주 긴 그림도 1px 아래로 내려가지 않는다', () => {
    assert.deepEqual(fitSize(800, 600, SHRINK.photo), { width: 800, height: 600 });
    assert.deepEqual(fitSize(20000, 2, SHRINK.photo), { width: 2048, height: 1 });
    assert.deepEqual(fitSize(0, 0, SHRINK.photo), { width: 0, height: 0 });
  });
});

describe('shrunkName · shrinkable', () => {
  test('확장자만 새 형식으로', () => {
    assert.equal(shrunkName('IMG_0001.HEIC.jpg', 'image/webp'), 'IMG_0001.HEIC.webp');
    assert.equal(shrunkName('로고.png', 'image/png'), '로고.png');
    assert.equal(shrunkName('사진', 'image/jpeg'), '사진.jpg');
    assert.equal(shrunkName('.jpg', 'image/webp'), 'photo.webp');
  });

  test('GIF(움직임) · SVG · 사진이 아닌 파일은 그대로 둔다', () => {
    assert.equal(shrinkable('image/jpeg'), true);
    assert.equal(shrinkable('image/png'), true);
    assert.equal(shrinkable('image/webp'), true);
    assert.equal(shrinkable('image/gif'), false);
    assert.equal(shrinkable('image/svg+xml'), false);
    assert.equal(shrinkable('application/pdf'), false);
  });
});
