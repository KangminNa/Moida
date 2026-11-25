import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, test } from 'node:test';
import { AppManifest } from './app-manifest';

// 앱 코드가 지도 회사 스크립트를 직접 넣지 못하게 (2026-11-25, docs/지도.md MP-1). 거절 목록은 지도 플러그인의 회사 목록과 같아야 한다:
// 서버는 src 밖을 가져오지 않아 목록을 옮겨 적고, 이 테스트가 plugins/map/providers.json의 sdkHosts와 맞춰 본다

const providers = JSON.parse(
  readFileSync(resolve(__dirname, '../../../../../../plugins/map/providers.json'), 'utf8'),
) as { providers: Record<string, { sdkHosts: string[] }> };
const sdkHosts = Object.values(providers.providers).flatMap((p) => p.sdkHosts);

describe('AppManifest 바깥 주소의 지도 회사', () => {
  test('지도 플러그인의 회사 스크립트 호스트는 모두 거절한다 (cairn.map으로)', () => {
    assert.ok(sdkHosts.length > 0);
    for (const host of sdkHosts)
      assert.throws(
        () => AppManifest.of(JSON.stringify({ cairn: 1, hosts: [host] })),
        /cairn\.map/,
        host,
      );
  });

  test('지도와 상관없는 호스트(글꼴)는 받는다', () => {
    const manifest = AppManifest.of('{"cairn":1,"hosts":["fonts.googleapis.com"]}');
    assert.deepEqual(manifest.hosts, ['fonts.googleapis.com']);
  });
});
