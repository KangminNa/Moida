import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AppCodeEntry } from './app-code-check';
import { MapCreditCheck } from './map-credit-check';

const css = (text: string) => new AppCodeEntry('style.css', text.length, text);

test('지도 출처 · 로고를 숨기는 규칙은 문제, 다른 규칙 · 보이게 하는 규칙은 넘긴다', () => {
  const hidden = MapCreditCheck.check([
    css('.map .leaflet-control-attribution { display: none }\n.card { display: none }'),
  ]);
  assert.equal(hidden?.ok, false);
  assert.match(hidden?.tail ?? '', /leaflet-control-attribution/);
  assert.equal(MapCreditCheck.check([css('.gm-style-cc{opacity:0}')])?.ok, false);
  assert.equal(
    MapCreditCheck.check([css('.leaflet-control-attribution { font-size: 10px }')]),
    null,
  );
  assert.equal(MapCreditCheck.check([css('.card { display: none }')]), null);
  assert.equal(MapCreditCheck.check([new AppCodeEntry('data.json', 2, '{}')]), null);
});
