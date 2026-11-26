import { NotFound, type SettingChangeInput, type SettingShape, type Sql } from '../../platform';
import type { Space } from './space';
import { RenameSpaceInput } from './space.input';
import { SpaceRepository } from './space.repository';

/**
 * 블로그 이름 · 소개 · 스토어 소개(한 줄 · 글, 2026-11-26) 바꾸기 한 번을 부르는 쪽의 트랜잭션에서 (2026-11-15 D, task의 AgentEdit과 같은 모양).
 * 설정 바꾸기 제안의 미리 해 보기와 승인 뒤 적용이 같은 줄을 지난다 (규칙은 관리자의 이름 바꾸기와 같은 Space.edit · describe).
 * 사이트 주소 · 앱 연결 허용 · 로고는 대화로 바꾸지 않는다 (로그인 · 바깥 연결이 걸려 화면에서만). 저장은 부르는 쪽이 정한다
 */
export class SpaceEdit {
  /** 대화로 바꾸는 사이트 (get_settings site · propose_setting site) */
  static readonly SETTING: SettingShape = {
    setting: 'site',
    list: 'site',
    ops: ['edit'],
    fields: ['name', 'description', 'tagline', 'about'],
    target: 'one',
    versioned: true,
    grants: [],
  };

  constructor(
    private readonly tx: Sql,
    private readonly spaceId: string,
  ) {}

  async apply(change: SettingChangeInput): Promise<Space> {
    const space = await new SpaceRepository(this.tx).lockCurrent();
    if (!space || space.id !== this.spaceId) throw new NotFound('블로그 공간을 찾을 수 없어요');
    space.assertVersion(change.version);
    const now = space.view().toJSON();
    const {
      name = now.name,
      description = now.description,
      tagline = now.tagline,
      about = now.about,
    } = change.body;
    const req = RenameSpaceInput.from({
      name,
      description,
      tagline,
      about,
      version: change.version,
    });
    space.edit(req.changes);
    space.describe(req.description, null);
    space.introduce(req.tagline, req.about);
    return space;
  }
}
