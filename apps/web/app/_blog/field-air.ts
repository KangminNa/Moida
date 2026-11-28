import type { FieldShape } from './field-particles';

// 화면 전체를 흐르는 점 (C안의 "가득 찬 화면", 2026-11-28): 모양을 이루는 점(FieldParticles) 뒤에서
// 화면 가득 흐른다. 흐름은 모양마다 다르고(모이기 · 돌기 · 빨려 들기), 마우스 둘레에서는 소용돌이로 비켜 간다.
// 화면 밖으로 나가면 반대쪽에서 들어온다. 사용자는 "C안은 점들이 전체 화면을 채웠는데 지금은 안 채워졌다"

type Mote = { x: number; y: number; z: number; vx: number; vy: number };

/** 퍼지는 물결 하나 (넘기기 · 보기 바꾸기). t는 지난 초, s는 세기 */
type Wave = { x: number; y: number; t: number; s: number };

export class FieldAir {
  private readonly motes: Mote[] = [];
  private readonly waves: Wave[] = [];

  constructor(w: number, h: number) {
    const count = w < 720 ? 1100 : 2600;
    for (let i = 0; i < count; i++)
      this.motes.push({
        x: Math.random() * w,
        y: Math.random() * h,
        z: Math.random(),
        vx: 0,
        vy: 0,
      });
  }

  /** 앞 그림 지우기: 조금씩 지워 움직이는 점에 짧은 꼬리가 남게 (C안). 움직임을 줄이는 설정이면 다 지운다 */
  static wipe(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    step: number,
    still: boolean,
  ): void {
    if (still) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }
    ctx.globalCompositeOperation = 'destination-out';
    ctx.globalAlpha = 1 - 0.66 ** step;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.globalCompositeOperation = 'source-over';
  }

  /** 화면 크기가 바뀌면 점을 새 크기 안에 고르게 다시 뿌린다 */
  spread(w: number, h: number): void {
    for (const m of this.motes) [m.x, m.y] = [Math.random() * w, Math.random() * h];
  }

  /** 흔들기: toward를 주면 그쪽(-1 왼쪽 · 1 오른쪽)으로, 없으면 사방으로. 가운데(cx, cy)에서 물결도 하나 */
  kick(s: number, toward: number, cx: number, cy: number): void {
    for (const m of this.motes) {
      m.vx += toward === 0 ? (Math.random() - 0.5) * 5 * s : toward * (1 + m.z * 3) * s;
      m.vy += (Math.random() - 0.5) * (toward === 0 ? 5 : 1.5) * s;
    }
    this.waves.push({ x: cx, y: cy, t: 0, s });
    if (this.waves.length > 4) this.waves.shift();
  }

  /** 한 걸음 움직이고 그린다. 움직임을 줄이는 설정(still)이면 제자리에 그리기만 */
  step(
    ctx: CanvasRenderingContext2D,
    f: { shape: FieldShape; t: number; dt: number; step: number; still: boolean },
    at: {
      w: number;
      h: number;
      cx: number;
      cy: number;
      R: number;
      mx: number;
      my: number;
      dpr: number;
    },
  ): void {
    const { shape, t, dt, step, still } = f;
    const { w, h, cx, cy, R, mx, my, dpr } = at;
    for (const wave of this.waves) wave.t += dt;
    while (this.waves[0] && this.waves[0].t > 1.4) this.waves.shift();
    const speed = w < 720 ? 460 : 760;
    const rings = this.waves.map((r) => ({ ...r, rad: r.t * speed, s: r.s * (1 - r.t / 1.4) }));
    const AR = w < 720 ? 137 : 212;
    const kf = Math.min(1, 0.05 * step);
    for (const m of this.motes) {
      const [dx, dy] = [m.x - cx, m.y - cy];
      const d = Math.hypot(dx, dy) || 1;
      const fade = shape === 'sphere' ? Math.min(1, Math.max(0, (d - R * 0.9) / (R * 0.45))) : 1;
      if (!still) {
        this.flow(m, shape, t, dx / d, dy / d, d, kf);
        const [px, py] = [m.x - mx, m.y - my];
        const pd = Math.hypot(px, py);
        if (pd < AR && pd > 0.1) {
          const g = (1 - pd / AR) ** 2 * 1.8 * step;
          m.vx += (px / pd) * g - (py / pd) * g * 0.9;
          m.vy += (py / pd) * g + (px / pd) * g * 0.9;
        }
        for (const r of rings) {
          const [qx, qy] = [m.x - r.x, m.y - r.y];
          const qd = Math.hypot(qx, qy) || 1;
          const band = Math.abs(qd - r.rad);
          if (band < 90) {
            const push = (1 - band / 90) * r.s * 2.4 * step;
            m.vx += (qx / qd) * push;
            m.vy += (qy / qd) * push;
          }
        }
        m.x += m.vx * step;
        m.y += m.vy * step;
        // 구에 빨려 든 점은 화면 가장자리에서 다시 (C안의 edge)
        if (shape === 'sphere' && d < R * 0.9) {
          const a = Math.random() * Math.PI * 2;
          const far = Math.hypot(w, h) * 0.55;
          [m.x, m.y, m.vx, m.vy] = [cx + Math.cos(a) * far, cy + Math.sin(a) * far, 0, 0];
        } else if (m.x < -20) m.x += w + 40;
        else if (m.x > w + 20) m.x -= w + 40;
        if (m.y < -20) m.y += h + 40;
        else if (m.y > h + 20) m.y -= h + 40;
      }
      if (fade <= 0) continue;
      ctx.globalAlpha = 0.9 * (0.12 + m.z * 0.5) * fade;
      const size = (0.6 + m.z * 1.4) * dpr;
      ctx.fillRect(m.x * dpr, m.y * dpr, size, size);
    }
    if (still) return;
    ctx.strokeStyle = ctx.fillStyle;
    ctx.lineWidth = dpr;
    for (const r of rings) {
      if (r.s <= 0) continue;
      ctx.globalAlpha = r.s * 0.22;
      ctx.beginPath();
      ctx.arc(r.x * dpr, r.y * dpr, r.rad * dpr, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  /** 모양마다의 흐름: 기본은 화면을 천천히 떠돌고, 마디는 밖으로 · 고리는 돌고 · 구는 빨려 든다 */
  private flow(
    m: Mote,
    shape: FieldShape,
    t: number,
    ux: number,
    uy: number,
    d: number,
    kf: number,
  ): void {
    const ang =
      (Math.sin(m.x * 0.0021 + t * 0.11 + m.z * 3) + Math.cos(m.y * 0.0026 - t * 0.09)) * 1.7;
    const sp = 0.3 + m.z * 0.7;
    let [fx, fy] = [Math.cos(ang) * sp, Math.sin(ang) * sp];
    if (shape === 'nodes') [fx, fy] = [fx * 0.4 + ux * sp * 4.2, fy * 0.4 + uy * sp * 4.2];
    else if (shape === 'orbit') [fx, fy] = [fx * 0.35 - uy * sp * 2.2, fy * 0.35 + ux * sp * 2.2];
    else if (shape === 'sphere') {
      const pull = sp * (2.2 + 300 / (d + 60));
      [fx, fy] = [fx * 0.25 - ux * pull - uy * pull * 0.6, fy * 0.25 - uy * pull + ux * pull * 0.6];
    } else if (shape === 'dust') [fx, fy] = [fx * 0.5, fy * 0.5];
    else [fx, fy] = [fx * 0.75, fy * 0.75];
    m.vx += (fx - m.vx) * kf;
    m.vy += (fy - m.vy) * kf;
  }
}
