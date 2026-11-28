import type { AppCodeEntry } from './app-code-check';
import { StageCheck } from './stage-check';

// 지도 출처 표시 검사 (docs/지도.md MP-3, 2026-11-27): 지도 회사 약관은 지도 위의 출처 · 로고를 늘 보이게 한다
// (OSM 타일 정책 · 네이버 로고 · 카카오 로고 · 구글 표시). 이번에 낸 CSS · HTML이 그 요소를 숨기는 규칙을 가졌으면 문제로 낸다.
// 화면에서는 moida.map이 그린 뒤 가려졌는지도 한 번 더 보고 콘솔에 알린다 (웹 moida-map.ts). 글만 훑는다: 실제로 가려지는지는 브라우저가 안다
export class MapCreditCheck {
  static readonly NAME = '지도 출처 표시';
  /** 출처 · 로고 요소 (Leaflet 출처 칸 · 회사 로고): 회사 SDK가 쓰는 이름 가운데 흔히 숨기려 드는 것 */
  private static readonly CREDIT =
    /\.(leaflet-control-attribution|leaflet-control-container|gm-style-cc|gmnoprint|naver-logo|kakao-?logo|nmap_logo)\b/i;
  /** 숨기는 선언 */
  private static readonly HIDE =
    /(display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0(?:\.0+)?\s*[;}!])/i;
  private static readonly SCREEN = /\.(html?|css)$/i;
  private static readonly RULE = /([^{}]+)\{([^{}]*)\}/g;

  /** made: 이번에 낸 파일. 지도 출처를 숨기는 규칙이 없으면 null (알릴 것이 없다) */
  static check(made: readonly AppCodeEntry[]): StageCheck | null {
    const found: string[] = [];
    for (const f of made) {
      if (!MapCreditCheck.SCREEN.test(f.name) || f.text === null) continue;
      for (const [, selector = '', body = ''] of f.text.matchAll(MapCreditCheck.RULE))
        if (MapCreditCheck.CREDIT.test(selector) && MapCreditCheck.HIDE.test(`${body};`))
          found.push(`${f.name}: ${selector.trim().slice(0, 80)}`);
    }
    if (found.length === 0) return null;
    return StageCheck.seen(
      MapCreditCheck.NAME,
      false,
      `${found.length}곳`,
      `지도 위의 출처 · 로고는 지도 회사 약관상 숨기지 않아요. 아래 규칙을 지워요\n${found.join('\n')}`,
    );
  }
}
