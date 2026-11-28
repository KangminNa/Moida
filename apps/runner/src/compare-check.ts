import { StageCheck } from './stage-check';

// 참고 화면과의 비교 검사 (2026-11-28, 사용자 "바깥 디자인 레퍼런스와 결과물의 차이를 비교하지 않고 주는건가?").
// 러너가 결과 화면을 찍은 일(ResultShots)에서, 이번에 화면을 냈으면 AI가 참고 화면과 찍은 화면을 나란히 보고 적은 비교가 있어야 한다:
//   앱은 design.md의 "## 비교", 페이지 · 슬라이드는 작업 자리의 .moida/compare.md. 셋(가져온 것 · 다른 점 · 고친 것)을 모두.
// 참고 화면(그림이나 메모)은 작업 자리의 .moida/refs/에 하나 이상. 처음 실행은 찍은 화면이 없어 대개 떨어지고,
// 다시 맡긴 실행이 찍은 화면을 열어 보고 비교를 적고 고친다. 그래도 없으면 결과에 적기만 한다 (일을 실패로 끝내지 않는다)
export class CompareCheck {
  static readonly NAME = '참고 화면과 비교';
  static readonly PARTS: readonly string[] = ['가져온 것', '다른 점', '고친 것'];
  static readonly HEADING = '비교';
  static readonly REFS = '.moida/refs';
  static readonly NOTE = '.moida/compare.md';
  private static readonly TITLE = /^##\s+(.+?)\s*$/;

  /**
   * text: 앱이면 design.md 전체, 아니면 compare.md (없으면 null). refs: .moida/refs/의 파일 수.
   * shots: 찍은 화면의 경로, place: 비교를 적을 곳의 이름
   */
  static check(
    text: string | null,
    app: boolean,
    refs: number,
    shots: readonly string[],
    place: string,
  ): StageCheck {
    const problems = CompareCheck.problems(text, app, refs, place);
    const ok = problems.length === 0;
    return StageCheck.seen(
      CompareCheck.NAME,
      ok,
      ok ? `참고 ${refs}개` : `${problems.length}개`,
      [
        `러너가 찍은 결과 화면(${shots.join(' · ')})을 열어 보고, 참고한 화면(${CompareCheck.REFS}/)과 나란히 비교해 ${place}에 적어요.`,
        `셋을 모두 적어요: 가져온 것(참고에서 따온 배치 · 색 · 글자 · 간격), 다른 점(우리 결과에서 다른 곳과 그 까닭), 고친 것(이번에 비교하고 고친 곳). 고칠 만한 다른 점은 이번에 고쳐요.`,
        ...problems.map((p) => `- ${p}`),
      ].join('\n'),
    );
  }

  private static problems(
    text: string | null,
    app: boolean,
    refs: number,
    place: string,
  ): string[] {
    const problems: string[] = [];
    if (refs === 0)
      problems.push(
        `${CompareCheck.REFS}/에 참고 화면이 없어요 (참고한 곳마다 그림이나 메모(주소 · 배치 · 색 · 글자 크기 · 간격) 하나)`,
      );
    const body = text === null ? null : app ? CompareCheck.section(text) : text;
    if (body === null) {
      problems.push(
        app
          ? `design.md에 "${CompareCheck.HEADING}" 제목(둘째 단계)이 없어요`
          : `${place}가 없어요`,
      );
      return problems;
    }
    for (const part of CompareCheck.PARTS)
      if (!body.includes(part)) problems.push(`${place}에 "${part}"이 없어요`);
    return problems;
  }

  /** 둘째 단계 제목 "비교" 아래부터 다음 제목 전까지. 제목이 없으면 null */
  private static section(text: string): string | null {
    const lines = text.split('\n').map((l) => l.trim());
    const titles = lines.map((l) => CompareCheck.TITLE.exec(l)?.[1] ?? null);
    const at = titles.indexOf(CompareCheck.HEADING);
    if (at < 0) return null;
    const end = titles.findIndex((t, i) => i > at && t !== null);
    return lines.slice(at + 1, end < 0 ? undefined : end).join('\n');
  }
}
