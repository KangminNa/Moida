import {
  RuleViolation,
  type SettingChangeInput,
  type SettingShape,
  ValueList,
} from '../../platform';
import { TERM_KIND, type TermKind } from '../community.tables';

// 일꾼의 약관 초안 제안 (2026-11-24, 스토어 3-4): 설정 바꾸기 `terms` 하나가 앱의 이용약관 · 개인정보처리방침 새 버전을 올리자고 한다.
// 관리자가 승인해야 공개된다 (원칙 7: 회원에게 보이는 약속). 대상 id는 앱, 칸은 { app_id, kind, body }.
// 버전을 쓰지 않고 바뀌기 전 값(지금 본문)으로 낡음을 본다: 승인 전에 관리자가 고쳐 올렸으면 적용이 실패한다
export class TermsChange {
  static readonly SETTING: SettingShape = {
    setting: 'terms',
    list: 'terms',
    ops: ['update'],
    fields: ['app_id', 'kind', 'body'],
    target: 'id',
    versioned: false,
    grants: 'all',
  };
  private static readonly UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

  private constructor(
    readonly appId: string,
    readonly kind: TermKind,
    readonly body: string,
  ) {}

  static of(change: SettingChangeInput): TermsChange {
    const { app_id: appId, kind, body } = change.body;
    if (typeof appId !== 'string' || !TermsChange.UUID.test(appId) || change.targetId !== appId)
      throw new RuleViolation('target_id와 app_id는 같은 앱의 id예요');
    if (!ValueList.has(TERM_KIND, kind))
      throw new RuleViolation('kind는 terms · privacy 가운데 하나예요');
    if (typeof body !== 'string') throw new RuleViolation('body는 약관 전체 글(마크다운)이에요');
    return new TermsChange(appId, kind, body);
  }
}
