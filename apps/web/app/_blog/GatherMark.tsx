'use client';

import { useEffect, useRef, useState } from 'react';
import { GatherScene } from './gather-scene';

/**
 * 스토어 첫 화면의 큰 이름: 흩어진 점이 모여 글자가 된다 (gather-scene.ts).
 * 스크립트가 돌기 전 · 화면 읽기 프로그램에는 글자 그대로 있고, 점이 그려지면 글자는 투명해진다.
 */
export function GatherMark({ name }: { name: string }) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const area = box.current;
    const board = canvas.current;
    if (!area || !board) return;
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const scene = new GatherScene(board, area, name, getComputedStyle(area).fontFamily, still);
    let live = true;
    void scene.start().then((ok) => {
      if (live && ok) setReady(true);
    });
    return () => {
      live = false;
      scene.dispose();
    };
  }, [name]);

  return (
    <div ref={box} className="store-mark" data-ready={ready ? '' : undefined}>
      <span className="store-mark-text">{name}</span>
      <canvas ref={canvas} />
    </div>
  );
}
