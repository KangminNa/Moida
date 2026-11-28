'use client';

import { Screen } from '../_plugins/installed/browser-tabs/Screen';
import { callFor } from '../_plugins/packages';
import type { BrowserClick } from './types';

const browserCall = callFor('browser-tabs');

// 사람이 넣을 칸 (개인정보 규칙 ①, 2026-11-28): 결제 수단 · 본인 인증 번호 · 주민번호 칸은 AI가 채우지 않고 멈췄다.
// 승인 전에 카드 안에서 서버 브라우저의 그 탭을 열어 직접 넣고, 승인하면 러너(AI 없음)가 같은 버튼을 누른다
export function ClickHuman({ click }: { click: BrowserClick }) {
  if (click.humanFields.length === 0 || click.status !== 'held') return null;
  return (
    <div className="click-after">
      <p className="warn">
        직접 넣을 칸: {click.humanFields.map((f) => `“${f}”`).join(' · ')}. 아래 화면에서 넣은 뒤
        승인해 주세요. 넣은 값은 AI에게 가지 않아요
      </p>
      <Screen call={browserCall} pin={{ url: click.pageUrl }} />
    </div>
  );
}
