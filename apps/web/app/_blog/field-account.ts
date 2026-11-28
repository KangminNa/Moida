// C안 로그인 · 가입 화면의 점 모양 (사용자 시안 2026-11-28 "C안 · 로그인 · 가입"): 가운데 구 = 계정 하나,
// 기울어진 고리 위를 도는 작은 구 넷 = 앱. 열 개 중 여섯은 큰 구, 둘은 작은 구(시간에 따라 돈다), 둘은 고리.
// FieldParticles가 'account' 모양일 때 부른다

const TAU = Math.PI * 2;
/** 고리의 반지름 (큰 구의 반지름 1 기준) */
const RING = 1.7;

/** 점 하나의 목표 자리 (r1~r4는 점마다 정한 무작위 값, t는 흐른 초) */
export function placeAccount(
  p: { tx: number; ty: number; tz: number; r1: number; r2: number; r3: number; r4: number },
  i: number,
  t: number,
): void {
  const c = i % 10;
  const z = p.r1 * 2 - 1;
  const th = p.r2 * TAU;
  const rr = Math.sqrt(1 - z * z);
  if (c < 6) {
    const r = i % 7 === 0 ? 0.4 + p.r3 * 0.5 : 0.985 + p.r3 * 0.03;
    [p.tx, p.ty, p.tz] = [rr * Math.cos(th) * r, z * r, rr * Math.sin(th) * r];
  } else if (c < 8) {
    const a = ((i % 4) * TAU) / 4 + t * 0.22;
    const [ox, oz] = [Math.cos(a) * RING, Math.sin(a) * RING];
    const r = 0.15 * (i % 5 === 0 ? 0.5 + p.r3 * 0.5 : 1);
    [p.tx, p.ty, p.tz] = [
      ox + rr * Math.cos(th) * r,
      oz * 0.18 + z * r,
      oz + rr * Math.sin(th) * r,
    ];
  } else {
    const a = p.r1 * TAU;
    const rad = RING + (p.r3 - 0.5) * 0.03;
    p.tx = Math.cos(a) * rad;
    p.tz = Math.sin(a) * rad;
    p.ty = p.tz * 0.18 + (p.r4 - 0.5) * 0.02;
  }
}

/** 고리 위의 작은 구처럼 시간에 따라 다시 놓을 점인가 */
export function accountMoves(i: number): boolean {
  const c = i % 10;
  return c === 6 || c === 7;
}
