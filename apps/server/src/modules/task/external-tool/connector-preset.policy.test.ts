import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { ConnectorPresets } from './connector-preset.policy';
import { ExternalTool } from './external-tool';

describe('ConnectorPresets (C2)', () => {
  test('키 · 이름이 겹치지 않고, 모두 커넥터 만들기의 규칙(이름 · 주소 · 로그인 방식 · 머리글)을 지난다', () => {
    const keys = ConnectorPresets.ALL.map((p) => p.key);
    assert.equal(new Set(keys).size, keys.length);
    assert.equal(new Set(ConnectorPresets.ALL.map((p) => p.name)).size, keys.length);
    for (const preset of ConnectorPresets.ALL) {
      const tool = ExternalTool.open('s', preset.name, ConnectorPresets.fields(preset), new Date());
      assert.equal(tool.name, preset.name);
      assert.match(preset.url, /^https:\/\//, preset.key);
      assert.ok(preset.does.length > 0, preset.key);
    }
  });

  test('목록에 없는 키는 404', () => {
    assert.throws(() => ConnectorPresets.find('nothing'), /추천 목록에 없는/);
  });
});
