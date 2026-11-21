import { SETTING_NAMES, settingField, settingValue } from './setting-labels';
import type { SettingChangeLine } from './types';

// 설정 바꾸기의 바뀔 칸 (2026-11-15 C · D): 어떤 설정인지, "칸: 전 → 후" 한 줄씩.
// 권한 · 승인 동작 · 커넥터 · 러너를 더하는 줄은 굵게 "권한 추가", 플러그인 설정(바깥으로 보내는 곳이 많다)은 모든 줄이 굵게 "바깥 연결".
// 결과 카드(ChatCardForm)와 승인 화면(ApprovalTargets)이 함께 쓴다
export function ChangeLines({
  lines,
  setting,
}: {
  lines: readonly SettingChangeLine[];
  setting?: string | null;
}) {
  if (lines.length === 0) return null;
  const name = setting ? (SETTING_NAMES[setting] ?? setting) : null;
  const strong = setting === 'plugin' ? '바깥 연결' : '권한 추가';
  return (
    <ul className="change-lines" aria-label={name ? `바뀔 칸 · ${name}` : '바뀔 칸'}>
      {name && <li className="change-setting">{name}</li>}
      {lines.map((l) => (
        <li key={l.field} className={l.grant ? 'grant' : undefined}>
          {l.grant && <span className="pill strong">{strong}</span>}
          <span className="change-field">{settingField(l.field, l.label)}</span>
          <span className="change-before">{settingValue(l.before, l.field, setting)}</span>
          <span>→</span>
          <span className="change-after">{settingValue(l.after, l.field, setting)}</span>
        </li>
      ))}
    </ul>
  );
}
