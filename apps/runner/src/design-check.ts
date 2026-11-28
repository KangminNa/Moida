import type { AppCodeEntry } from './app-code-check';
import { StageCheck } from './stage-check';

/** 색 토큰 블록 하나 (`:root { … }`): 이름 → #rrggbb */
class TokenBlock {
  constructor(readonly colors: ReadonlyMap<string, string>) {}
}

// 앱 화면 · 페이지의 디자인 기준 검사 (2026-11-24, 스킬 moida-make의 references/design.md 6장).
// AI가 낸 HTML · CSS의 글을 훑어 기계로 볼 수 있는 것만 본다: 색 토큰 짝의 대비 · viewport · lang · 포커스 · 작은 글자 · alt · 움직임 줄이기.
// 떨어지면 JobRun이 AI에게 한 번 더 맡기고, 그래도 떨어지면 결과에 적기만 한다 (일을 실패로 끝내지 않는다: 보기의 문제라서).
// 앞 코드(받은 것)의 문제는 묻지 않는다: 이번에 낸 파일만 본다. viewport · lang은 화면 전체(앞 코드 + 낸 것)에서 찾는다 (머리 조각에 있을 수 있다)
export class DesignCheck {
  static readonly NAME = '디자인 기준';
  /** 본문 글자 대비 (WCAG 2.2 AA) */
  static readonly CONTRAST_MIN = 4.5;
  static readonly FONT_PX_MIN = 12;
  /** 잴 색 짝: [글자, 바탕] */
  private static readonly PAIRS: readonly (readonly [string, string])[] = [
    ['--fg', '--bg'],
    ['--muted', '--bg'],
    ['--fg', '--surface'],
    ['--accent-fg', '--accent'],
    ['--accent', '--bg'],
  ];
  private static readonly STYLE = /\.css$/i;
  private static readonly PAGE = /\.html?$/i;
  private static readonly SHOWN = 12;

  static isStyle(name: string): boolean {
    return DesignCheck.STYLE.test(name);
  }

  /** made: 이번에 낸 파일, all: 앞 코드 위에 얹은 전체. 낸 HTML · CSS가 없으면 null (볼 것이 없다) */
  static check(made: readonly AppCodeEntry[], all: readonly AppCodeEntry[]): StageCheck | null {
    const mine = made.filter(
      (f) => f.text !== null && (DesignCheck.isStyle(f.name) || DesignCheck.PAGE.test(f.name)),
    );
    if (mine.length === 0) return null;
    const pages = all.filter((f) => f.text !== null && DesignCheck.PAGE.test(f.name));
    const problems = [
      ...DesignCheck.contrast(mine),
      ...DesignCheck.screen(pages, mine),
      ...mine.flatMap((f) => DesignCheck.fileProblems(f.name, f.text ?? '')),
    ];
    const ok = problems.length === 0;
    const shown = problems.slice(0, DesignCheck.SHOWN);
    if (problems.length > shown.length) shown.push(`… 그 밖에 ${problems.length - shown.length}개`);
    return StageCheck.seen(
      DesignCheck.NAME,
      ok,
      ok ? `${mine.length}개 통과` : `${problems.length}개`,
      `스킬의 references/design.md 기준에 맞지 않아요. 아래를 고쳐요\n${shown.join('\n')}`,
    );
  }

  /** 두 색의 대비 (WCAG 상대 휘도) */
  static ratio(a: string, b: string): number {
    const [hi, lo] = [DesignCheck.luminance(a), DesignCheck.luminance(b)].sort((x, y) => y - x);
    return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
  }

  /** :root 블록마다 함께 적힌 색 짝만 잰다 (어두운 화면 블록도 하나의 블록) */
  private static contrast(files: readonly AppCodeEntry[]): string[] {
    const problems: string[] = [];
    for (const f of files)
      for (const block of DesignCheck.blocks(f.text ?? ''))
        for (const [front, back] of DesignCheck.PAIRS) {
          const a = block.colors.get(front);
          const b = block.colors.get(back);
          if (!a || !b) continue;
          const r = DesignCheck.ratio(a, b);
          if (r < DesignCheck.CONTRAST_MIN)
            problems.push(
              `${f.name}: ${front} ${a} / ${back} ${b}의 대비가 ${r.toFixed(2)}:1이에요 (${DesignCheck.CONTRAST_MIN}:1 이상)`,
            );
        }
    return problems;
  }

  /**
   * viewport 메타: 이번에 <head>를 쓴 화면이 있을 때만 화면 전체(앞 코드 + 낸 것)에서 찾는다.
   * 조각(list.html)만 고친 일은 머리 조각(head.html)을 그대로 쓰므로 묻지 않는다
   */
  private static screen(pages: readonly AppCodeEntry[], mine: readonly AppCodeEntry[]): string[] {
    const wroteHead = mine.some(
      (f) => DesignCheck.PAGE.test(f.name) && /<head[\s>]/i.test(f.text ?? ''),
    );
    if (!wroteHead) return [];
    const texts = [...pages, ...mine].map((f) => f.text ?? '');
    if (texts.some((t) => /<meta[^>]+name=["']?viewport/i.test(t))) return [];
    return [
      '화면에 viewport 메타가 없어요: <meta name="viewport" content="width=device-width, initial-scale=1">',
    ];
  }

  private static fileProblems(name: string, text: string): string[] {
    const problems: string[] = [];
    const html = DesignCheck.PAGE.test(name);
    if (/user-scalable\s*=\s*(no|0)|maximum-scale\s*=\s*1(\.0)?\b/i.test(text))
      problems.push(`${name}: 확대를 막지 않아요 (user-scalable=no · maximum-scale=1 빼기)`);
    if (html && /<html(?![^>]*\blang=)[^>]*>/i.test(text))
      problems.push(`${name}: <html>에 lang="ko"가 없어요`);
    if (/outline\s*:\s*(none|0)\b/i.test(text) && !/:focus-visible/i.test(text))
      problems.push(
        `${name}: outline을 지웠으면 :focus-visible에 보이는 포커스를 둬요 (outline: 2px solid var(--accent))`,
      );
    for (const m of text.matchAll(/font-size\s*:\s*(\d+(?:\.\d+)?)px/gi))
      if (Number(m[1]) < DesignCheck.FONT_PX_MIN) {
        problems.push(
          `${name}: font-size ${m[1]}px는 너무 작아요 (${DesignCheck.FONT_PX_MIN}px 이상, rem으로)`,
        );
        break;
      }
    if (html) {
      const bare = [...text.matchAll(/<img\b[^>]*>/gi)].find((m) => !/\balt\s*=/i.test(m[0]));
      if (bare) problems.push(`${name}: alt가 없는 <img>가 있어요 (꾸밈 그림은 alt="")`);
    }
    if (/@keyframes|animation\s*:/i.test(text) && !/prefers-reduced-motion/i.test(text))
      problems.push(`${name}: 움직임을 쓰면 @media (prefers-reduced-motion: reduce)에서 멈춰요`);
    return problems;
  }

  /** `:root { … }` 블록들의 색 토큰. 값이 #rgb · #rrggbb인 것만 */
  private static blocks(text: string): TokenBlock[] {
    const found: TokenBlock[] = [];
    for (const m of text.matchAll(/:root\s*\{([^}]*)\}/gi)) {
      const colors = new Map<string, string>();
      for (const d of (m[1] ?? '').matchAll(
        /(--[\w-]+)\s*:\s*(#[0-9a-f]{3}|#[0-9a-f]{6})\b\s*;?/gi,
      ))
        colors.set((d[1] ?? '').toLowerCase(), DesignCheck.hex(d[2] ?? '#000'));
      if (colors.size > 0) found.push(new TokenBlock(colors));
    }
    return found;
  }

  private static hex(value: string): string {
    const v = value.slice(1).toLowerCase();
    return v.length === 3 ? `#${[...v].map((c) => c + c).join('')}` : `#${v}`;
  }

  private static luminance(color: string): number {
    const v = DesignCheck.hex(color).slice(1);
    const [r, g, b] = [0, 2, 4].map((i) => {
      const c = Number.parseInt(v.slice(i, i + 2), 16) / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
  }
}
