// 공통 앱 도메인 첫 화면(C안, 2026-11-27)의 점 그림. 점 수천 개가 모양(일 카드 · 이어진 컴퓨터 · 도는 고리 · 구)으로 모였다가
// 앱 보기에서는 어두운 바탕 그대로 화면 가득 흩어져 옅어진다(2026-11-28 D1). 마우스가 지나가면 밀려난다. 움직임을 줄이는 설정이면 돌지 않고 바로 자리를 잡는다.
// React와 상관없는 그리기만 (AppsField가 만들고 모양을 바꾸고 멈춘다).
// 로그인 · 가입 화면(AuthField, 2026-11-28)은 'account' 모양을 왼쪽에 두고, 글자를 칠 때마다 점을 밖으로 한 번 민다(pulse)

import { accountMoves, placeAccount } from './field-account';
import { FieldAir } from './field-air';

export type FieldShape = 'task' | 'nodes' | 'orbit' | 'sphere' | 'dust' | 'account';

type Dot = {
  x: number;
  y: number;
  z: number;
  tx: number;
  ty: number;
  tz: number;
  ox: number;
  oy: number;
  r1: number;
  r2: number;
  r3: number;
  r4: number;
  k: number;
  a: number;
};

const TAU = Math.PI * 2;

/** #rrggbb → [r, g, b] (토큰을 읽지 못하면 fallback) */
function rgbOf(hex: string, fallback: [number, number, number]): [number, number, number] {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  return m
    ? [
        Number.parseInt(m[1] ?? '0', 16),
        Number.parseInt(m[2] ?? '0', 16),
        Number.parseInt(m[3] ?? '0', 16),
      ]
    : fallback;
}

/** 둥근 네모의 둘레를 따라 s만큼 간 자리 */
function roundRect(s: number, hw: number, hh: number, cr: number): [number, number] {
  const sx = 2 * (hw - cr);
  const sy = 2 * (hh - cr);
  const q = (Math.PI * cr) / 2;
  const segs = [sx, q, sy, q, sx, q, sy, q];
  let k = 0;
  let rest = s;
  while (k < 7 && rest > (segs[k] ?? 0)) {
    rest -= segs[k] ?? 0;
    k++;
  }
  const u = Math.min(1, rest / (segs[k] ?? 1));
  const h = Math.PI / 2;
  const arc = (cx: number, cy: number, from: number): [number, number] => [
    cx + Math.cos(from + u * h) * cr,
    cy + Math.sin(from + u * h) * cr,
  ];
  if (k === 0) return [-hw + cr + u * sx, -hh];
  if (k === 1) return arc(hw - cr, -hh + cr, -h);
  if (k === 2) return [hw, -hh + cr + u * sy];
  if (k === 3) return arc(hw - cr, hh - cr, 0);
  if (k === 4) return [hw - cr - u * sx, hh];
  if (k === 5) return arc(-hw + cr, hh - cr, h);
  if (k === 6) return [-hw, hh - cr - u * sy];
  return arc(-hw + cr, -hh + cr, 2 * h);
}

/** 단위 구 위의 점 (r 배) */
function onSphere(p: Dot, r: number): void {
  const z = p.r1 * 2 - 1;
  const th = p.r2 * TAU;
  const rr = Math.sqrt(1 - z * z);
  p.tx = rr * Math.cos(th) * r;
  p.ty = z * r;
  p.tz = rr * Math.sin(th) * r;
}

export class FieldParticles {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly dots: Dot[] = [];
  private readonly reduced: boolean;
  private readonly paper: [number, number, number];
  private shape: FieldShape = 'dust';
  private mx = -9999;
  private my = -9999;
  private t = 0;
  private rot = 0;
  private tilt = 0;
  private last = 0;
  private raf = 0;
  private w = 1;
  private h = 1;
  private dpr = 1;
  private cx = 0;
  private cy = 0;
  private R = 1;
  private readonly resize: ResizeObserver | null;
  /** 화면 전체를 흐르는 점 (C안) */
  private readonly air: FieldAir;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    shape: FieldShape,
    /** 모양을 둘 쪽: 첫 화면은 오른쪽(글이 왼쪽), 로그인 · 가입은 왼쪽(판이 오른쪽) */
    private readonly side: 'right' | 'left' = 'right',
  ) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('캔버스를 열지 못했어요');
    this.ctx = ctx;
    this.reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const style = getComputedStyle(canvas);
    this.paper = rgbOf(style.getPropertyValue('--field-paper'), [239, 238, 233]);
    const count = (canvas.clientWidth || 1440) < 720 ? 1800 : 4200;
    for (let i = 0; i < count; i++)
      this.dots.push({
        ...{ x: 0, y: 0, z: 0, tx: 0, ty: 0, tz: 0, ox: 0, oy: 0 },
        ...{ r1: Math.random(), r2: Math.random(), r3: Math.random(), r4: Math.random() },
        k: 0.03 + Math.random() * 0.05,
        a: Math.random() * TAU,
      });
    this.measure();
    this.air = new FieldAir(this.w, this.h);
    this.setShape('dust');
    for (const p of this.dots) [p.x, p.y, p.z] = [p.tx, p.ty, p.tz];
    this.setShape(shape);
    this.resize =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => this.remeasure());
    this.resize?.observe(canvas);
    this.last = performance.now();
    const loop = (now: number) => {
      this.frame(now);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
    this.resize?.disconnect();
  }

  setShape(shape: FieldShape): void {
    this.shape = shape;
    this.dots.forEach((p, i) => {
      this.place(p, i, shape);
    });
  }

  /**
   * 점을 한 번 민다 (s: 세기, 글자를 칠 때 0.35 · 탭을 바꿀 때 0.8). toward를 주면 그쪽(-1 왼쪽 · 1 오른쪽)으로 쏠리고
   * (앱 카드를 넘길 때), 없으면 가운데에서 밖으로. 움직임을 줄이는 설정이면 하지 않는다
   */
  pulse(s: number, toward = 0): void {
    if (this.reduced) return;
    for (const p of this.dots) {
      const d = Math.hypot(p.x, p.y) || 1;
      const f = (3 + p.r3 * 8) * s;
      p.ox += toward === 0 ? (p.x / d) * f : toward * f * (0.6 + p.r2);
      p.oy += toward === 0 ? (p.y / d) * f : 0;
    }
    this.air.kick(s, toward, this.cx, this.cy);
  }

  /** 마우스 자리 (캔버스 기준). 밖으로 나가면 null */
  pointer(at: { x: number; y: number } | null): void {
    const r = this.canvas.getBoundingClientRect();
    [this.mx, this.my] = at ? [at.x - r.left, at.y - r.top] : [-9999, -9999];
  }

  private remeasure(): void {
    this.measure();
    this.air.spread(this.w, this.h);
    this.setShape(this.shape);
  }

  private measure(): void {
    const c = this.canvas;
    this.w = c.clientWidth || 1;
    this.h = c.clientHeight || 1;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    c.width = Math.round(this.w * this.dpr);
    c.height = Math.round(this.h * this.dpr);
    const narrow = this.w < 720;
    // 모양의 가운데 · 크기 (화면 너비 · 높이의 비): [cx, cy, R을 정하는 너비 비, 높이 비]
    const [fx, fy, rw, rh] = narrow
      ? [0.5, 0.36, ...(this.side === 'left' ? [0.26, 0.13] : [0.34, 0.2])]
      : this.side === 'left'
        ? [0.3, 0.42, 0.16, 0.25]
        : [0.68, 0.4, 0.2, 0.28];
    [this.cx, this.cy] = [this.w * (fx ?? 0.5), this.h * (fy ?? 0.4)];
    this.R = Math.min(this.w * (rw ?? 0.2), this.h * (rh ?? 0.28));
  }

  private place(p: Dot, i: number, shape: FieldShape): void {
    const t = this.t;
    if (shape === 'sphere') onSphere(p, i % 7 === 0 ? 0.4 + p.r3 * 0.5 : 0.985 + p.r3 * 0.03);
    else if (shape === 'orbit') this.orbit(p, i, t);
    else if (shape === 'account') placeAccount(p, i, t);
    else if (shape === 'task') {
      if (i % 10 < 7) {
        const [hw, hh, cr] = [1.3, 0.82, 0.2];
        const length = 4 * (hw - cr) + 4 * (hh - cr) + 2 * Math.PI * cr;
        const [x, y] = roundRect(p.r1 * length, hw, hh, cr);
        p.tx = x + (p.r3 - 0.5) * 0.12;
        p.ty = y + (p.r4 - 0.5) * 0.12;
      } else {
        const row = i % 3;
        p.tx = -0.9 + p.r1 * ([1.0, 1.8, 1.3][row] ?? 1) + (p.r3 - 0.5) * 0.03;
        p.ty = ([-0.34, 0, 0.34][row] ?? 0) + (p.r4 - 0.5) * 0.07;
      }
      p.tz = (p.r2 - 0.5) * 0.06;
    } else if (shape === 'nodes') this.node(p, i, t);
    else {
      const [x0, x1] = [-this.cx / this.R, (this.w - this.cx) / this.R];
      const [y0, y1] = [-this.cy / this.R, (this.h - this.cy) / this.R];
      p.tx = x0 + p.r1 * (x1 - x0);
      p.ty = y0 + p.r2 * (y1 - y0);
      p.tz = (p.r3 - 0.5) * 0.6;
    }
  }

  /** 가운데 작은 구와 기울어진 고리 셋 (고리의 점은 돈다) */
  private orbit(p: Dot, i: number, t: number): void {
    if (i % 10 < 3) {
      onSphere(p, 0.36 * Math.cbrt(0.25 + p.r3 * 0.75));
      return;
    }
    const ring = i % 3;
    const rad = ([0.72, 1.0, 1.28][ring] ?? 1) + (p.r3 - 0.5) * 0.05;
    const a = p.r2 * TAU + t * ([0.5, -0.36, 0.24][ring] ?? 0);
    const ax = [0.42, -0.36, 0.18][ring] ?? 0;
    const az = [0.5, -0.55, 0.08][ring] ?? 0;
    const [x, y, z] = [Math.cos(a) * rad, (p.r4 - 0.5) * 0.04, Math.sin(a) * rad];
    const y1 = y * Math.cos(ax) - z * Math.sin(ax);
    p.tz = y * Math.sin(ax) + z * Math.cos(ax);
    p.tx = x * Math.cos(az) - y1 * Math.sin(az);
    p.ty = x * Math.sin(az) + y1 * Math.cos(az);
  }

  /** 가운데 하나와 둘레의 다섯 (컴퓨터들), 그 사이를 오가는 점 */
  private node(p: Dot, i: number, t: number): void {
    const c = i % 25;
    const a = -Math.PI / 2 + ((i % 5) * TAU) / 5;
    const [nx, ny] = [Math.cos(a) * 1.2, Math.sin(a) * 0.92];
    if (c >= 3 && c < 8) {
      const s = (p.r1 + t * 0.32) % 1;
      [p.tx, p.ty, p.tz] = [nx * s + (p.r3 - 0.5) * 0.03, ny * s + (p.r4 - 0.5) * 0.03, 0];
      return;
    }
    onSphere(p, (c < 3 ? 0.22 : 0.26) * (i % 6 === 0 ? 0.5 + p.r3 * 0.5 : 1));
    if (c >= 3) [p.tx, p.ty] = [p.tx + nx, p.ty + ny];
  }

  private frame(now: number): void {
    const dt = Math.min(0.05, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    this.t += dt;
    const step = Math.min(2.5, dt * 60);
    const shape = this.shape;
    const spin = shape === 'sphere' || shape === 'orbit' || shape === 'account';
    if (!this.reduced) {
      if (spin) this.rot += dt * 0.2;
      else {
        const goal = Math.round(this.rot / TAU) * TAU + Math.sin(this.t * 0.4) * 0.2;
        this.rot += (goal - this.rot) * Math.min(1, dt * 1.6);
      }
    }
    this.tilt += ((spin ? -0.22 : 0) - this.tilt) * Math.min(1, dt * 1.6);
    if (shape === 'orbit' || shape === 'nodes' || shape === 'account')
      this.dots.forEach((p, i) => {
        if (
          shape === 'account'
            ? accountMoves(i)
            : shape === 'orbit'
              ? i % 10 >= 3
              : i % 25 >= 3 && i % 25 < 8
        )
          this.place(p, i, shape);
      });
    this.draw(step, dt);
  }

  private draw(step: number, dt: number): void {
    const { ctx, canvas, R, cx, cy, dpr, mx, my, t } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    FieldAir.wipe(ctx, canvas, step, this.reduced);
    ctx.fillStyle = `rgb(${this.paper.join(',')})`;
    const at = { w: this.w, h: this.h, cx, cy, R, mx, my, dpr };
    this.air.step(ctx, { shape: this.shape, t, dt, step, still: this.reduced }, at);
    const [cosR, sinR, cosT, sinT] = [
      Math.cos(this.rot),
      Math.sin(this.rot),
      Math.cos(this.tilt),
      Math.sin(this.tilt),
    ];
    const F = 3.4;
    const wob = this.reduced ? 0 : this.shape === 'dust' ? 0.05 : 0.014; // 앱 보기의 흩어진 점은 크게 떠다닌다
    const base = 0.82;
    for (const p of this.dots) {
      const kk = this.reduced ? 1 : Math.min(1, p.k * step);
      p.x += (p.tx - p.x) * kk;
      p.y += (p.ty - p.y) * kk;
      p.z += (p.tz - p.z) * kk;
      const x = p.x + Math.sin(t * 0.8 + p.a) * wob;
      const y = p.y + Math.cos(t * 0.65 + p.a * 1.7) * wob;
      const x1 = x * cosR + p.z * sinR;
      const z1 = p.z * cosR - x * sinR;
      const y2 = y * cosT - z1 * sinT;
      const z2 = y * sinT + z1 * cosT;
      const s = F / (F - z2);
      let sx = cx + x1 * R * s;
      let sy = cy + y2 * R * s;
      const [dx, dy] = [sx + p.ox - mx, sy + p.oy - my];
      const d2 = dx * dx + dy * dy;
      if (d2 < 10000 && d2 > 0.01) {
        const d = Math.sqrt(d2);
        const push = (1 - d / 100) * 2.2 * step;
        p.ox += (dx / d) * push;
        p.oy += (dy / d) * push;
      }
      p.ox *= 0.93;
      p.oy *= 0.93;
      sx += p.ox;
      sy += p.oy;
      if (sx < -4 || sy < -4 || sx > this.w + 4 || sy > this.h + 4) continue;
      const depth = Math.min(1, Math.max(0, (z2 + 1.3) / 2.6));
      ctx.globalAlpha = base * (0.22 + depth * 0.78);
      const size = (0.8 + p.r4) * s * dpr;
      ctx.fillRect(sx * dpr, sy * dpr, size, size);
    }
    ctx.globalAlpha = 1;
  }
}
