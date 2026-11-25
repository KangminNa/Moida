-- migrate:up
-- 지도 플러그인 2차 MP-1 (2026-11-25, docs/지도.md): 브라우저용 키 칸 하나(key)를 회사마다의 칸으로 나눈다
-- (kakaoJsKey · naverClientId · googleBrowserKey). 지금 고른 회사의 칸으로 값을 옮기고, osm이거나 회사를 모르면 지운다.
-- 키는 공개 값이라 value에 있다 (secret_ciphertext가 아니다)
INSERT INTO platform.plugin_settings (plugin, key, value, updated_at, updated_by)
SELECT k.plugin,
       CASE p.value
         WHEN 'kakao' THEN 'kakaoJsKey'
         WHEN 'naver' THEN 'naverClientId'
         WHEN 'google' THEN 'googleBrowserKey'
       END,
       k.value, k.updated_at, k.updated_by
FROM platform.plugin_settings k
JOIN platform.plugin_settings p ON p.plugin = k.plugin AND p.key = 'provider'
WHERE k.plugin = 'map' AND k.key = 'key' AND k.value IS NOT NULL
  AND p.value IN ('kakao', 'naver', 'google')
ON CONFLICT (plugin, key) DO NOTHING;

DELETE FROM platform.plugin_settings WHERE plugin = 'map' AND key = 'key';

-- migrate:down
-- 고른 회사의 칸을 옛 key로 되돌린다 (다른 회사의 칸은 옛 모양에 자리가 없어 지운다)
INSERT INTO platform.plugin_settings (plugin, key, value, updated_at, updated_by)
SELECT k.plugin, 'key', k.value, k.updated_at, k.updated_by
FROM platform.plugin_settings k
JOIN platform.plugin_settings p ON p.plugin = k.plugin AND p.key = 'provider'
WHERE k.plugin = 'map' AND k.value IS NOT NULL
  AND k.key = CASE p.value
                WHEN 'kakao' THEN 'kakaoJsKey'
                WHEN 'naver' THEN 'naverClientId'
                WHEN 'google' THEN 'googleBrowserKey'
              END
ON CONFLICT (plugin, key) DO NOTHING;

DELETE FROM platform.plugin_settings
WHERE plugin = 'map' AND key IN ('kakaoJsKey', 'naverClientId', 'googleBrowserKey', 'osmTiles');
