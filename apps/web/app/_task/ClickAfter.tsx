'use client';

import { Screen } from '../_plugins/installed/browser-tabs/Screen';
import { callFor } from '../_plugins/packages';
import type { BrowserClick } from './types';

const browserCall = callFor('browser-tabs');

// 승인 후 클릭 뒤 확인 (L3): 러너가 누른 뒤 그 화면에서 고른 것.
//   auth: 결제 · 본인 인증 화면이 떴다 → 카드 안에서 서버 브라우저의 그 탭을 열어 직접 마친다 (넣은 값은 AI를 거치지 않는다)
//   done: 결과 화면 → 예약 · 주문 번호와 페이지 제목
export function ClickAfter({ click }: { click: BrowserClick }) {
  const c = click.confirm;
  if (!c) return null;
  if (c.state === 'auth')
    return (
      <div className="click-after">
        <p className="warn">
          결제 · 본인 인증 화면이 떴어요. 아래 화면에서 직접 마쳐 주세요. 넣은 값은 AI에게 가지
          않아요
        </p>
        <Screen call={browserCall} pin={{ url: click.afterUrl ?? click.pageUrl }} />
      </div>
    );
  return (
    <dl className="kv">
      <dt>누른 결과</dt>
      <dd>
        {c.reference ? `번호 ${c.reference}` : '번호 없음'}
        {c.title ? ` · ${c.title}` : ''}
      </dd>
    </dl>
  );
}
