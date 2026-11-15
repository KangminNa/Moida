import { SETTING_FIELDS, settingValue } from './setting-labels';
import type { SettingChangeLine } from './types';

// 설정 바꾸기의 바뀔 칸 (2026-11-15 C): "칸: 전 → 후" 한 줄씩. 권한 · 승인 동작 · 커넥터 · 러너를 더하는 줄은 굵게, "권한 추가" 표시.
// 결과 카드(ChatCardForm)와 승인 화면(ApprovalTargets)이 함께 쓴다
export function ChangeLines({ lines }: { lines: readonly SettingChangeLine[] }) {
  if (lines.length === 0) return null;
  return (
    <ul className="change-lines" aria-label="바뀔 칸">
      {lines.map((l) => (
        <li key={l.field} className={l.grant ? 'grant' : undefined}>
          {l.grant && <span className="pill strong">권한 추가</span>}
          <span className="change-field">{SETTING_FIELDS[l.field] ?? l.field}</span>
          <span className="change-before">{settingValue(l.before)}</span>
          <span>→</span>
          <span className="change-after">{settingValue(l.after)}</span>
        </li>
      ))}
    </ul>
  );
}
