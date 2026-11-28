import { serverRaw } from '../_lib/server-api';
import type { PluginPublicSettings } from '../_platform/types';
import { CLIENTS } from '../_plugins/clients.generated';

// 플러그인의 앱 라이브러리 조각 (2026-11-28, 목록 파일 client.file): 켜진 플러그인의 브라우저 스크립트를 moida.js 뒤에 붙인다.
// 켜졌는지는 지도 설정(map-config.ts)과 같은 길로 안다: 그 플러그인의 공개 설정을 읽어 받으면 켜진 것, 못 받으면(꺼짐 · 서버에 못 닿음) 뺀다.
// 조각마다 함수 하나로 감싸 window.moida와 그 플러그인의 공개 설정(비밀 칸은 서버가 빼고 준다)을 넘긴다. 30초 기억한다 (앱 화면마다 부르므로)

const KEEP_MS = 30_000;

let known: { at: number; parts: readonly string[] } | null = null;

/** 켜진 플러그인의 조각들 (moida.js에 그대로 이어 붙일 글자) */
export async function pluginClients(): Promise<readonly string[]> {
  if (CLIENTS.length === 0) return [];
  if (known && Date.now() - known.at < KEEP_MS) return known.parts;
  const parts: string[] = [];
  for (const client of CLIENTS) {
    const settings = await settingsOf(client.plugin);
    if (settings) parts.push(clientPart(client.source, settings));
  }
  known = { at: Date.now(), parts };
  return parts;
}

/** 조각 하나: 한 플러그인의 스크립트가 다른 것을 깨지 않게 따로 감싸고, 설정 JSON의 '<'는 글자로 바꿔 </script>로 끝나지 않게 */
export function clientPart(source: string, settings: Readonly<Record<string, unknown>>): string {
  const json = JSON.stringify(settings).replace(/</g, '\\u003c');
  return `try {\n((moida, settings) => {\n${source}\n})(window.moida, ${json});\n} catch (error) {\n  console.error(error);\n}`;
}

async function settingsOf(plugin: string): Promise<Record<string, unknown> | null> {
  const res = await serverRaw(`/api/plugins/${encodeURIComponent(plugin)}/settings`);
  if (!res?.ok) return null;
  const body = (await res.json().catch(() => null)) as PluginPublicSettings | null;
  return body ? { ...(body.settings ?? {}) } : null;
}
