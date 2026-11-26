import type { CSSProperties } from 'react';

// Moida 표식 (2026-11-26, Cairn 돌탑을 바꿈): 가운데 점 하나와 둘레의 점 여섯이 모인 모양 ('모이다').
// 글자색을 따라가서 흰 바탕 · 검은 바탕 어디서나 같게 보인다.
// gather면 둘레의 점이 바깥에서 가운데로 모여들며 나타난다 (설치 · 로그인 · 기기 연결 화면, globals.css의 .mark .st)

/** 둘레의 점 여섯: 위에서부터 시계 방향, 반지름 8 */
const RING = Array.from({ length: 6 }, (_, i) => {
  const angle = ((-90 + i * 60) * Math.PI) / 180;
  return {
    x: 12 + 8 * Math.cos(angle),
    y: 12 + 8 * Math.sin(angle),
    dx: Math.cos(angle),
    dy: Math.sin(angle),
  };
});

export function MoidaMark({ size = 22, gather = false }: { size?: number; gather?: boolean }) {
  const st = (i: number, dx: number, dy: number) =>
    gather
      ? {
          className: 'st',
          style: {
            animationDelay: `${0.05 + i * 0.07}s`,
            '--dx': `${dx * 9}px`,
            '--dy': `${dy * 9}px`,
          } as CSSProperties,
        }
      : {};
  return (
    <svg
      className={gather ? 'mark' : undefined}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      {RING.map((p, i) => (
        <circle key={`${p.x}-${p.y}`} {...st(i, p.dx, p.dy)} cx={p.x} cy={p.y} r="1.9" />
      ))}
      <circle {...st(RING.length, 0, 0)} cx="12" cy="12" r="3.4" />
    </svg>
  );
}
