import { NotFound, type Unchecked } from '../../platform';
import type { ExternalToolRow } from '../task.tables';
import PRESETS from './connector-presets.json';

/** 추천 커넥터 하나 (connector-presets.json의 한 줄) */
export interface ConnectorPresetRow {
  key: string;
  name: string;
  title: string;
  url: string;
  auth: string;
  header?: string;
  does: string;
  setup?: string;
}

// 추천 커넥터 (C2, 2026-11-28, docs/MCP.md 8장): 저장소에 둔 공식 원격 MCP 목록. 더하기는 관리자가 커넥터를 더하는 길
// (ExternalTool.open)과 같아 주소 · 로그인 방식 · 머리글의 규칙은 엔티티가 본다 (목록은 테스트가 그 규칙으로 미리 본다).
// 상태 없음
// biome-ignore lint/complexity/noStaticOnlyClass: 상태 없는 목록 한 곳. Service · Query가 쓴다
export class ConnectorPresets {
  static readonly ALL: readonly ConnectorPresetRow[] = PRESETS.presets;

  /** 키로 하나. 목록에 없으면 404 */
  static find(key: string): ConnectorPresetRow {
    const found = ConnectorPresets.ALL.find((p) => p.key === key);
    if (!found) throw new NotFound('추천 목록에 없는 커넥터예요');
    return found;
  }

  /** 커넥터의 칸 (만들기와 같은 모양) */
  static fields(preset: ConnectorPresetRow): Partial<Unchecked<ExternalToolRow>> {
    return {
      title: preset.title,
      url: preset.url,
      auth: preset.auth,
      header_name: preset.header ?? null,
    };
  }
}
