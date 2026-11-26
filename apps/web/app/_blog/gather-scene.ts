// 스토어 첫 화면의 큰 이름 (2026-11-26, 사용자 "THREE.JS 수준으로 인터렉션"). 3D 공간에 흩어진 점이 모여 회사 이름이 된다.
// 3D 점 구름을 Canvas 2D에 원근으로 그린다. 라이브러리 없음 (_vault/graph-scene.ts와 같은 방식):
// three.js는 이 효과 하나에 묶음을 크게 늘리고, 점 몇천 개의 회전 · 원근은 직접 계산으로 충분하다.
// 마우스를 따라 기울고, 가까이 가면 점이 밀려나고, 누르면 흩어졌다가 다시 모인다. 글자는 물결치듯 숨쉰다.
// 색은 globals.css의 토큰(--fg · --accent)만 읽는다. 움직임 줄이기를 켠 사람에게는 모인 글자를 한 번만 그린다.

const MAX_POINTS = 2600;
const PHONE_POINTS = 1300;
const PHONE_WIDTH = 600;
/** 원근의 초점 거리 (작을수록 깊이가 크게 보인다) */
const FOCAL = 720;
const SPRING = 0.045;
const DAMPING = 0.86;
const REPEL_RADIUS = 80;
const REPEL_FORCE = 2.6;
/** 처음 모이기: 왼쪽부터 오른쪽으로 차례로 (ms) */
const SWEEP_MS = 700;
const BURST_RADIUS = 420;
/** 누른 뒤 점이 퍼지는 동안 돌아오는 힘을 줄인다 (ms) */
const BURST_MS = 320;
const ACCENT_SHARE = 0.12;
const TAU = Math.PI * 2;

export class GatherScene {
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly stop = new AbortController();
  private width = 0;
  private height = 0;
  private dpr = 1;
  private dot = 1;
  private count = 0;
  // 점마다: 자리 · 속도 · 모일 자리 · 모이기 시작하는 때 · 강조색인지 · 마지막으로 그린 화면 자리
  private x = new Float32Array(0);
  private y = new Float32Array(0);
  private z = new Float32Array(0);
  private vx = new Float32Array(0);
  private vy = new Float32Array(0);
  private vz = new Float32Array(0);
  private tx = new Float32Array(0);
  private ty = new Float32Array(0);
  private tz = new Float32Array(0);
  private delay = new Float32Array(0);
  private accent = new Uint8Array(0);
  private sx = new Float32Array(0);
  private sy = new Float32Array(0);
  private rotX = 0;
  private rotY = 0;
  private pointer: { x: number; y: number } | null = null;
  private started = 0;
  private burstAt = -1e9;
  private raf = 0;
  private frames = 0;
  private seen = true;
  private colors = { fg: '', accent: '' };

  constructor(
    private readonly canvas: HTMLCanvasElement,
    /** 마우스 · 누르기를 받는 곳 (캔버스를 감싼 칸) */
    private readonly area: HTMLElement,
    private readonly text: string,
    private readonly font: string,
    private readonly still: boolean,
  ) {
    this.ctx = canvas.getContext('2d');
  }

  /** 글꼴을 기다려 글자를 점으로 바꾸고 움직이기 시작한다. 그릴 수 없으면 false (화면은 글자 그대로) */
  async start(): Promise<boolean> {
    if (!this.ctx || !this.text.trim()) return false;
    try {
      await document.fonts.load(`900 64px ${this.font}`, this.text);
    } catch {
      // 글꼴을 못 받아도 기본 글꼴로 그린다
    }
    if (this.stop.signal.aborted) return false;
    this.readColors();
    this.resize(true);
    if (this.count === 0) return false;
    if (!this.still) this.listen();
    return true;
  }

  dispose(): void {
    this.stop.abort();
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  private listen(): void {
    const on = { signal: this.stop.signal };
    const at = (e: PointerEvent) => {
      const box = this.canvas.getBoundingClientRect();
      return { x: e.clientX - box.left, y: e.clientY - box.top };
    };
    this.area.addEventListener('pointermove', (e) => (this.pointer = at(e)), on);
    this.area.addEventListener('pointerleave', () => (this.pointer = null), on);
    this.area.addEventListener('pointerdown', (e) => this.burst(at(e)), on);
    document.addEventListener('visibilitychange', () => this.schedule(), on);
    const sizes = new ResizeObserver(() => this.resize(false));
    sizes.observe(this.canvas);
    const view = new IntersectionObserver(([entry]) => {
      this.seen = entry?.isIntersecting ?? true;
      this.schedule();
    });
    view.observe(this.canvas);
    this.stop.signal.addEventListener('abort', () => {
      sizes.disconnect();
      view.disconnect();
    });
    this.started = performance.now();
    this.schedule();
  }

  private schedule(): void {
    if (this.raf || this.stop.signal.aborted || !this.seen || document.hidden) return;
    this.raf = requestAnimationFrame(this.tick);
  }

  /** 칸 크기가 바뀌면 글자를 다시 점으로. 처음에는 흩어진 자리에서, 그 뒤에는 지금 자리에서 모인다 */
  private resize(first: boolean): void {
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    if (!width || !height || (!first && width === this.width && height === this.height)) return;
    this.width = width;
    this.height = height;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(width * this.dpr);
    this.canvas.height = Math.round(height * this.dpr);
    const { points, gap } = this.sample();
    this.dot = Math.max(0.9, gap * 0.38);
    this.place(points, first && !this.still);
    this.draw();
  }

  /** 글자를 화면 밖 캔버스에 쓰고, 칠해진 자리를 일정한 간격으로 골라 점의 모일 자리로 */
  private sample(): { points: { x: number; y: number }[]; gap: number } {
    const w = Math.round(this.width);
    const h = Math.round(this.height);
    const off = document.createElement('canvas');
    off.width = w;
    off.height = h;
    const c = off.getContext('2d', { willReadFrequently: true });
    if (!c) return { points: [], gap: 1 };
    let size = h * 0.5;
    c.font = `900 ${size}px ${this.font}`;
    const measured = c.measureText(this.text).width;
    if (measured > w * 0.9) size *= (w * 0.9) / measured;
    c.font = `900 ${size}px ${this.font}`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(this.text, w / 2, h / 2);
    const data = c.getImageData(0, 0, w, h).data;
    const limit = w < PHONE_WIDTH ? PHONE_POINTS : MAX_POINTS;
    for (let gap = 2; ; gap++) {
      const points: { x: number; y: number }[] = [];
      for (let py = 0; py < h; py += gap)
        for (let px = 0; px < w; px += gap)
          if ((data[(py * w + px) * 4 + 3] ?? 0) > 140)
            points.push({ x: px - w / 2, y: py - h / 2 });
      if (points.length <= limit || gap >= 12) return { points, gap };
    }
  }

  private place(points: readonly { x: number; y: number }[], scatter: boolean): void {
    const old = { n: this.count, x: this.x, y: this.y, z: this.z };
    const n = points.length;
    this.count = n;
    for (const key of [
      'x',
      'y',
      'z',
      'vx',
      'vy',
      'vz',
      'tx',
      'ty',
      'tz',
      'delay',
      'sx',
      'sy',
    ] as const)
      this[key] = new Float32Array(n);
    this.accent = new Uint8Array(n);
    const reach = Math.max(this.width, this.height) * 0.7;
    for (let i = 0; i < n; i++) {
      const p = points[i] ?? { x: 0, y: 0 };
      this.tx[i] = p.x;
      this.ty[i] = p.y;
      this.tz[i] = (Math.random() - 0.5) * 10;
      this.accent[i] = Math.random() < ACCENT_SHARE ? 1 : 0;
      this.delay[i] = ((p.x + this.width / 2) / this.width) * SWEEP_MS + Math.random() * 500;
      if (i < old.n) {
        this.x[i] = old.x[i] ?? p.x;
        this.y[i] = old.y[i] ?? p.y;
        this.z[i] = old.z[i] ?? 0;
      } else if (scatter) {
        // 납작한 공 껍질 위의 아무 자리: 흩어져 있다가 모인다
        const r = reach * (0.55 + Math.random() * 0.6);
        const theta = Math.random() * TAU;
        const phi = Math.acos(2 * Math.random() - 1);
        this.x[i] = r * Math.sin(phi) * Math.cos(theta);
        this.y[i] = r * Math.sin(phi) * Math.sin(theta) * 0.55;
        this.z[i] = r * Math.cos(phi);
      } else {
        this.x[i] = p.x;
        this.y[i] = p.y;
        this.z[i] = this.tz[i] ?? 0;
      }
    }
  }

  /** 누른 자리에서 바깥으로 밀어 흩는다. 잠시 뒤 다시 모인다 */
  private burst(at: { x: number; y: number }): void {
    this.burstAt = performance.now();
    for (let i = 0; i < this.count; i++) {
      const dx = (this.sx[i] ?? 0) - at.x;
      const dy = (this.sy[i] ?? 0) - at.y;
      const d = Math.hypot(dx, dy) || 1;
      const push = 16 * (1 - Math.min(d, BURST_RADIUS) / BURST_RADIUS) + 3 + Math.random() * 4;
      this.vx[i] = (this.vx[i] ?? 0) + (dx / d) * push + (Math.random() - 0.5) * 6;
      this.vy[i] = (this.vy[i] ?? 0) + (dy / d) * push + (Math.random() - 0.5) * 6;
      this.vz[i] = (this.vz[i] ?? 0) + (Math.random() - 0.5) * 40;
    }
    this.schedule();
  }

  private readonly tick = (now: number): void => {
    this.raf = 0;
    if (this.stop.signal.aborted || !this.seen || document.hidden) return;
    if (++this.frames % 60 === 0) this.readColors();
    this.aim(now);
    this.step(now);
    this.draw();
    this.raf = requestAnimationFrame(this.tick);
  };

  /** 기울기: 마우스가 있으면 그쪽으로, 없으면 천천히 흔들린다 */
  private aim(now: number): void {
    const p = this.pointer;
    const toY = p ? (p.x / this.width - 0.5) * 0.7 : Math.sin(now * 0.00035) * 0.18;
    const toX = p ? -(p.y / this.height - 0.5) * 0.5 : Math.sin(now * 0.00027) * 0.08;
    this.rotY += (toY - this.rotY) * 0.05;
    this.rotX += (toX - this.rotX) * 0.05;
  }

  private step(now: number): void {
    const t = now - this.started;
    const loose = now - this.burstAt < BURST_MS;
    const p = this.pointer;
    for (let i = 0; i < this.count; i++) {
      const k = loose ? 0.004 : t > (this.delay[i] ?? 0) ? SPRING : 0.002;
      const tx = this.tx[i] ?? 0;
      const ty = this.ty[i] ?? 0;
      const wave = Math.sin(now * 0.0015 + tx * 0.011 + ty * 0.006) * 7;
      let vx = ((this.vx[i] ?? 0) + (tx - (this.x[i] ?? 0)) * k) * DAMPING;
      let vy = ((this.vy[i] ?? 0) + (ty - (this.y[i] ?? 0)) * k) * DAMPING;
      let vz = ((this.vz[i] ?? 0) + ((this.tz[i] ?? 0) + wave - (this.z[i] ?? 0)) * k) * DAMPING;
      if (p) {
        const dx = (this.sx[i] ?? 0) - p.x;
        const dy = (this.sy[i] ?? 0) - p.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < REPEL_RADIUS * REPEL_RADIUS) {
          const d = Math.sqrt(d2) || 1;
          const f = (1 - d / REPEL_RADIUS) * REPEL_FORCE;
          vx += (dx / d) * f;
          vy += (dy / d) * f;
          vz -= f * 2.5;
        }
      }
      this.vx[i] = vx;
      this.vy[i] = vy;
      this.vz[i] = vz;
      this.x[i] = (this.x[i] ?? 0) + vx;
      this.y[i] = (this.y[i] ?? 0) + vy;
      this.z[i] = (this.z[i] ?? 0) + vz;
    }
  }

  /** 돌리고(Y축 · X축) 원근으로 화면에 옮겨 그린다. 가까운 점은 크고 진하다. 기본색 한 번, 강조색 한 번 */
  private draw(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);
    const cosY = Math.cos(this.rotY);
    const sinY = Math.sin(this.rotY);
    const cosX = Math.cos(this.rotX);
    const sinX = Math.sin(this.rotX);
    for (const tone of [0, 1]) {
      ctx.fillStyle = tone ? this.colors.accent : this.colors.fg;
      for (let i = 0; i < this.count; i++) {
        const x = this.x[i] ?? 0;
        const y = this.y[i] ?? 0;
        const z = this.z[i] ?? 0;
        const x1 = x * cosY + z * sinY;
        const z1 = -x * sinY + z * cosY;
        const y1 = y * cosX - z1 * sinX;
        const z2 = y * sinX + z1 * cosX;
        const depth = FOCAL / (FOCAL + z2);
        const sx = this.width / 2 + x1 * depth;
        const sy = this.height / 2 + y1 * depth;
        this.sx[i] = sx;
        this.sy[i] = sy;
        if (this.accent[i] !== tone || depth <= 0) continue;
        ctx.globalAlpha = Math.min(1, Math.max(0.15, depth * depth * 0.9));
        ctx.beginPath();
        ctx.arc(sx, sy, this.dot * Math.min(depth, 2), 0, TAU);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  private readColors(): void {
    const style = getComputedStyle(document.documentElement);
    this.colors = {
      fg: style.getPropertyValue('--fg').trim() || 'black',
      accent: style.getPropertyValue('--accent').trim() || 'black',
    };
  }
}
