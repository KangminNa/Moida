import {
  RuleViolation,
  type SettingChangeInput,
  type SettingShape,
  type Sql,
} from '../../platform';
import type { ExternalTool } from './external-tool';
import { ExternalToolRepository } from './external-tool.repository';

/**
 * 대화로 커넥터 켜기 · 끄기 · 이름표 (C4 도구 우선순위, 2026-11-27, docs/MCP.md 8장).
 * 주소 · 로그인 방식 · 토큰은 화면에서만 바꾼다 (주소를 바꾸면 승인한 도구 목록이 처음부터라, 토큰은 비밀이라).
 * 에이전트에게 허락하는 것은 agent 설정의 external_tools. 제안의 미리 해 보기와 승인 뒤 적용이 같은 줄이다
 */
export class ConnectorEdit {
  static readonly SETTING: SettingShape = {
    setting: 'connector',
    list: 'connectors',
    ops: ['edit'],
    fields: ['enabled', 'title'],
    target: 'id',
    versioned: true,
    grants: ['enabled'],
  };

  constructor(
    private readonly tx: Sql,
    private readonly spaceId: string,
  ) {}

  async apply(change: SettingChangeInput, now: Date): Promise<ExternalTool> {
    if (change.targetId === null) throw new RuleViolation('바꿀 커넥터의 id를 보내요');
    const tool = await new ExternalToolRepository(this.tx).lock(this.spaceId, change.targetId);
    tool.assertVersion(change.version);
    const { enabled, title } = change.body;
    if (title !== undefined) tool.edit({ title: String(title) }, now);
    if (enabled !== undefined) {
      if (typeof enabled !== 'boolean') throw new RuleViolation('enabled는 true · false예요');
      tool.switchTo(enabled, now);
    }
    return tool;
  }
}
