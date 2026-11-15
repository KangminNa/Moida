// 대화로 바꿀 수 있는 설정 (2026-11-15 D)의 모양: 설정을 가진 모듈과 platform의 약속, get_settings의 목록

/** 설정 하나의 모양 (설정을 가진 모듈의 Edit이 static SETTING으로 갖는다) */
export interface SettingShape {
  /** propose_setting의 setting */
  readonly setting: string;
  /** get_settings의 kind */
  readonly list: string;
  readonly ops: readonly string[];
  /** 받는 칸 (get_settings와 같은 snake_case). null이면 대상마다 달라 그 모듈이 미리 해 보기에서 본다 (플러그인) */
  readonly fields: readonly string[] | null;
  /** 대상: id(target_id) · one(공간에 하나, 대상 칸 없음) · name(target_name) */
  readonly target: 'id' | 'one' | 'name';
  /** version으로 낡음을 보는가. 아니면 승인 뒤 적용 때 바뀌기 전 값을 비교한다 (SettingChangeInput.assertUnchanged) */
  readonly versioned: boolean;
  /** 굵게 보일 칸. 'all'이면 모든 줄 */
  readonly grants: readonly string[] | 'all';
  /** 키마다 한 줄로 펼칠 목록형 칸 (알림 경로 · 프로젝트별 모으기) */
  readonly maps?: readonly string[];
}

/** get_settings {} (kind 없이): 바꿀 수 있는 설정과 칸. 바꾸려면 kind로 지금 값과 version을 읽는다 */
export class SettingCatalogView {
  constructor(private readonly shapes: readonly SettingShape[]) {}

  toJSON() {
    return {
      kinds: this.shapes.map((s) => ({
        kind: s.list,
        setting: s.setting,
        ops: s.ops,
        fields: s.fields,
        target: s.target,
      })),
    };
  }
}

/** 설정 한 줄의 읽기 모양 (모듈의 View) */
interface SettingLine {
  toJSON(): object;
}

/** get_settings의 공간에 하나인 설정 (알림 · 사이트 · 세션 정리): { <kind>: 그 설정 한 줄 } */
export class SettingOneView {
  constructor(
    private readonly list: string,
    private readonly one: SettingLine,
  ) {}

  toJSON() {
    return { [this.list]: this.one.toJSON() };
  }
}
