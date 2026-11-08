import type { Pace } from './types.ts';

export interface SimClock {
  now(): number;
  /** 等到 target（null 表示无限期）或被 wake() 提前唤醒，返回醒来时的时间 */
  waitUntil(target: number | null): Promise<number>;
  wake(): void;
  /** 一次模型调用结束后推进时钟，返回推进后的时间 */
  advance(ms: number): number;
  dispose(): void;
}

interface Waiter {
  target: number | null;
  resolve: (t: number) => void;
}

/**
 * 剧本模式的虚拟时钟。等待时间按节奏换算成真实时间：
 * speed 倍速、instant 不等待、step 等用户点"下一步"。
 * 模型调用的耗时由引擎通过 advance() 按实际毫秒数计入。
 */
export class VirtualClock implements SimClock {
  private t = 0;
  private waiter: Waiter | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private armedAt = 0;

  constructor(private currentPace: Pace) {}

  get pace(): Pace {
    return this.currentPace;
  }

  get waiting(): boolean {
    return this.waiter !== null;
  }

  now() {
    return this.t;
  }

  advance(ms: number) {
    this.t += Math.max(0, ms);
    return this.t;
  }

  waitUntil(target: number | null) {
    this.settle(this.t);
    return new Promise<number>((resolve) => {
      this.waiter = { target, resolve };
      this.arm();
    });
  }

  setPace(pace: Pace) {
    if (this.waiter && this.currentPace.kind === 'speed' && this.timer) {
      const elapsed = (performance.now() - this.armedAt) * this.currentPace.speed;
      const target = this.waiter.target ?? this.t;
      this.t = Math.min(target, this.t + elapsed);
    }
    this.currentPace = pace;
    this.clearTimer();
    this.arm();
  }

  step() {
    if (this.waiter) this.settle(this.waiter.target ?? this.t);
  }

  wake() {
    this.settle(this.t);
  }

  dispose() {
    this.settle(this.t);
  }

  private arm() {
    const w = this.waiter;
    if (!w || w.target === null || this.currentPace.kind === 'step') return;
    const remaining = Math.max(0, w.target - this.t);
    const delay = this.currentPace.kind === 'instant' ? 0 : remaining / this.currentPace.speed;
    this.armedAt = performance.now();
    this.timer = setTimeout(() => this.settle(w.target!), delay);
  }

  private settle(at: number) {
    this.clearTimer();
    const w = this.waiter;
    if (!w) return;
    this.waiter = null;
    this.t = Math.max(this.t, at);
    w.resolve(this.t);
  }

  private clearTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}

/** 单人实时模式：时间就是开播以来的真实时间 */
export class LiveClock implements SimClock {
  private readonly origin = performance.now();
  private waiter: ((t: number) => void) | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  now() {
    return Math.round(performance.now() - this.origin);
  }

  advance() {
    return this.now();
  }

  waitUntil(target: number | null) {
    this.wake();
    return new Promise<number>((resolve) => {
      this.waiter = resolve;
      if (target !== null) this.timer = setTimeout(() => this.wake(), Math.max(0, target - this.now()));
    });
  }

  wake() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const w = this.waiter;
    this.waiter = null;
    w?.(this.now());
  }

  dispose() {
    this.wake();
  }
}
