import {
  RuleViolation,
  type SettingChangeInput,
  type SettingShape,
  type Sql,
} from '../../platform';
import { Goal } from './goal';
import { CreateGoalInput, UpdateGoalInput } from './goal.input';
import { GoalRepository } from './goal.repository';

/**
 * 목표 만들기 · 고치기 한 번을 부르는 쪽의 트랜잭션에서 (2026-11-15 D, AgentEdit과 같은 모양).
 * 관리자의 만들기(GoalService), 설정 바꾸기 제안의 미리 해 보기, 승인 뒤 적용이 같은 줄을 지난다. 저장은 부르는 쪽이 정한다
 */
export class GoalEdit {
  /** 대화로 바꾸는 목표 (get_settings goals · propose_setting goal). 상위 목표는 만들 때만, 상태는 고칠 때만 */
  static readonly SETTING: SettingShape = {
    setting: 'goal',
    list: 'goals',
    ops: ['create', 'edit'],
    fields: ['title', 'description', 'parent_id', 'sort', 'status'],
    target: 'id',
    versioned: true,
    grants: [],
  };

  constructor(
    private readonly tx: Sql,
    private readonly spaceId: string,
  ) {}

  /** 새 목표 (아직 저장 전). 부모를 잠가 두고 만든다: 그사이 부모가 끝나면 끝난 목표 아래에 생긴다 */
  async open(req: CreateGoalInput, now: Date): Promise<Goal> {
    const goals = new GoalRepository(this.tx);
    const parent = req.parentId === null ? null : await goals.lock(this.spaceId, req.parentId);
    const depth = parent ? await goals.depthOf(parent.id) : 0;
    return Goal.open(this.spaceId, parent, depth, req.fields, now);
  }

  /** 칸 고치기와 상태 바꾸기 (설정 바꾸기는 둘을 한 번에 할 수 있다) */
  async update(req: UpdateGoalInput, status: string | null): Promise<Goal> {
    const goal = await new GoalRepository(this.tx).lock(this.spaceId, req.id);
    goal.assertVersion(req.version);
    goal.edit(req.changes);
    if (status !== null) goal.changeStatus(status);
    return goal;
  }

  /** 설정 바꾸기 하나: 제안의 미리 해 보기와 승인 뒤 적용이 같은 줄. body는 get_settings와 같은 칸, key는 만들기의 requestId */
  apply(change: SettingChangeInput, now: Date): Promise<Goal> {
    const { status, parent_id: parentId, ...fields } = change.body;
    if (change.op === 'create') {
      if (status !== undefined)
        throw new RuleViolation('새 목표는 진행 중으로 시작해요 (상태는 만든 뒤에 바꿔요)');
      return this.open(
        CreateGoalInput.from({ ...fields, parentId: parentId ?? null, requestId: change.key }),
        now,
      );
    }
    if (parentId !== undefined) throw new RuleViolation('상위 목표는 만들 때만 정해요');
    return this.update(
      UpdateGoalInput.from(String(change.targetId), { ...fields, version: change.version }),
      status === undefined || status === null ? null : String(status),
    );
  }
}
