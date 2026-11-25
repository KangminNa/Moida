import type { AppCodeEntry } from './app-code-check';
import { StageCheck } from './stage-check';

// 앱의 디자인 문서 검사 (2026-11-25, 스킬 cairn-make의 references/design-research.md).
// 앱 화면은 정해 둔 스타일에서 고르지 않고, 같은 분야의 화면을 찾아 보고 쓴 이 앱만의 디자인 문서(design.md)를 따른다.
// 이번에 화면(HTML · CSS)을 낸 앱 코드 일이면, 묶음(앞 코드 + 낸 것)에 그 문서가 있고 정해진 제목과 실제로 연 참고 주소가 있는지 본다.
// 떨어지면 AI에게 한 번 더 맡기고, 그래도 떨어지면 결과에 적기만 한다 (디자인 기준 검사와 같다: 일을 실패로 끝내지 않는다).
// 글만 훑는다: 주소가 실제로 열렸는지는 러너가 알 수 없다 (문서 쓰는 법에 "실제로 연 주소만"이라고 적어 둔다)
export class DesignDocCheck {
  static readonly NAME = '디자인 문서';
  static readonly FILE = 'design.md';
  /** 문서를 글로 읽는 한도 */
  static readonly BYTES_MAX = 64 * 1024;
  /** 있어야 할 둘째 단계 제목(## …)의 이름 */
  static readonly HEADINGS: readonly string[] = ['한 줄', '참고한 곳', '방향', '토큰'];
  private static readonly HEADING = /^##\s+(.+?)\s*$/;
  static readonly LINKS_MIN = 2;
  private static readonly SCREEN = /\.(html?|css)$/i;
  private static readonly LINK = /https?:\/\/[^\s)>\]]+/gi;

  /** made: 이번에 낸 파일, all: 앞 코드 위에 얹은 전체. 화면을 내지 않았으면 null (볼 것이 없다) */
  static check(made: readonly AppCodeEntry[], all: readonly AppCodeEntry[]): StageCheck | null {
    if (!made.some((f) => DesignDocCheck.SCREEN.test(f.name))) return null;
    const doc = all.find((f) => f.name === DesignDocCheck.FILE);
    const problems = DesignDocCheck.problems(doc?.text ?? null, doc !== undefined);
    const ok = problems.length === 0;
    return StageCheck.seen(
      DesignDocCheck.NAME,
      ok,
      ok ? DesignDocCheck.FILE : `${problems.length}개`,
      `스킬의 references/design-research.md대로 참고할 화면을 찾아 보고 ${DesignDocCheck.FILE}를 써요. 아래를 고쳐요\n${problems.join('\n')}`,
    );
  }

  private static problems(text: string | null, present: boolean): string[] {
    if (!present) return [`묶음 맨 위에 ${DesignDocCheck.FILE}가 없어요`];
    if (text === null) return [`${DesignDocCheck.FILE}를 읽지 못했어요 (64KB까지의 글로)`];
    const lines = text.split('\n').map((l) => l.trim());
    const titles = lines.map((l) => DesignDocCheck.HEADING.exec(l)?.[1] ?? null);
    const problems = DesignDocCheck.HEADINGS.filter((h) => !titles.includes(h)).map(
      (h) => `${DesignDocCheck.FILE}에 "${h}" 제목(## ${h})이 없어요`,
    );
    const refs = DesignDocCheck.section(lines, titles, '참고한 곳').join('\n');
    const links = new Set(refs.match(DesignDocCheck.LINK));
    if (links.size < DesignDocCheck.LINKS_MIN)
      problems.push(
        `"참고한 곳"에 실제로 연 주소가 ${DesignDocCheck.LINKS_MIN}개 이상 있어야 해요 (지금 ${links.size}개)`,
      );
    return problems;
  }

  /** 그 제목 아래부터 다음 제목(##) 전까지 */
  private static section(
    lines: readonly string[],
    titles: readonly (string | null)[],
    title: string,
  ): string[] {
    const at = titles.indexOf(title);
    if (at < 0) return [];
    const end = titles.findIndex((t, i) => i > at && t !== null);
    return lines.slice(at + 1, end < 0 ? undefined : end);
  }
}
