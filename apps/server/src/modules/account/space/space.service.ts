import { Injectable } from '@nestjs/common';
import {
  Actor,
  AttemptLimiter,
  BaseService,
  BlobStore,
  Conflict,
  Database,
  Forbidden,
  HostGate,
  NotFound,
  SecurityLog,
  SettingActor,
  type SettingChangeInput,
  SettingOutcome,
} from '../../platform';
import { InstallPolicy } from './install.policy';
import { Space } from './space';
import type {
  HostedAppsInput,
  InstallCodeInput,
  RemoveLogoInput,
  RenameSpaceInput,
  UploadLogoInput,
} from './space.input';
import { SpaceQuery } from './space.query';
import { SpaceRepository } from './space.repository';
import { SpaceEdit } from './space-edit';

// 공간 쓰기: 설치 코드 확인(공간 만들기), 블로그 이름·소개·사이트 주소 바꾸기, 로고, 앱 연결 허용.
// 이름 · 소개는 대화에서 AI가 제안한 것을 승인해서도 바꾼다 (2026-11-15 D, SpaceEdit).
@Injectable()
export class SpaceService extends BaseService {
  /** 설치 코드는 한 곳에서 1분에 5번까지 */
  private readonly attempts = new AttemptLimiter(5, 60_000);

  constructor(
    db: Database,
    private readonly install: InstallPolicy,
    private readonly spaces: SpaceQuery,
    private readonly blobs: BlobStore,
    private readonly gate: HostGate,
  ) {
    super(db);
  }

  /** 설치 코드가 맞으면 공간을 만들고(없을 때) 10분짜리 설치 통행증을 돌려준다. from: 요청한 곳(IP) */
  async verifyInstallCode(actor: Actor, req: InstallCodeInput, from: string): Promise<string> {
    this.attempts.hit(AttemptLimiter.place(from));
    if (!this.install.matches(req.code)) {
      // 보안 기록 (install.failed). 오류에 표시해 오류 필터가 거부된 접근으로 다시 남기지 않게
      await this.transaction(async (tx) => {
        await new SecurityLog(tx).record({
          space_id: null,
          kind: 'install.failed',
          ip: from,
          user_agent: null,
        });
      });
      throw new Forbidden('install', '맞지 않는 설치 코드예요').markRecorded();
    }
    if ((await this.spaces.installStatus(actor, null)).installed)
      throw new Conflict('이미 설치된 블로그예요. 로그인해 주세요');
    const space = await this.transaction(async (tx) => {
      const repo = new SpaceRepository(tx);
      const found = (await repo.lockCurrent()) ?? Space.open();
      if (found.isNew) await repo.save(found);
      return found;
    }).catch(async (error) => {
      // 두 브라우저가 동시에 처음 공간을 만들면 하나만 들어간다. 그 공간을 쓴다
      if (!Database.isUniqueViolation(error)) throw error;
      return new SpaceRepository(this.db.sql).current();
    });
    if (!space) throw new NotFound('블로그 공간을 만들지 못했어요');
    return this.install.issuePass(space.id);
  }

  /** 사이트 주소가 바뀌었을 수 있어 HostGate가 기본 도메인을 다시 읽게 한다 (스토어 3-0) */
  async rename(actor: Actor, req: RenameSpaceInput): Promise<Space> {
    const space = await this.change(actor, req.version, (space) => {
      space.edit(req.changes);
      space.describe(req.description, req.siteUrl);
      space.introduce(req.tagline, req.about, req.highlights);
    });
    this.gate.stale();
    return space;
  }

  /**
   * 로고 올리기 (주인만). 파일은 트랜잭션 밖에서 쓰고(같은 내용이면 있던 파일), 공간에는 해시만 남긴다.
   * 판이 낡아 저장하지 못하면 파일만 남고, 아무도 쓰지 않으니 platform의 청소가 지운다
   */
  async uploadLogo(actor: Actor, req: UploadLogoInput): Promise<Space> {
    actor.assertOwner();
    const blob = await this.blobs.save(req.bytes, req.mime);
    return this.change(actor, req.version, (space) => space.setLogo(blob.hash));
  }

  removeLogo(actor: Actor, req: RemoveLogoInput): Promise<Space> {
    return this.change(actor, req.version, (space) => space.setLogo(null));
  }

  setHostedApps(actor: Actor, req: HostedAppsInput): Promise<Space> {
    return this.change(actor, req.version, (space) => space.allowHostedApps(req.on));
  }

  /** 주인만. 공간은 하나뿐이라 id 없이 잠근다. 나머지 순서는 EntityService.change와 같다 */
  /** 설정 바꾸기 제안의 미리 해 보기 (2026-11-15 D): 같은 줄(SpaceEdit)을 지나고 저장하지 않는다 */
  async rehearseSetting(actor: Actor, change: SettingChangeInput): Promise<void> {
    const spaceId = SettingActor.spaceOf(actor);
    await this.transaction(async (tx) => {
      await new SpaceEdit(tx, spaceId).apply(change);
    });
  }

  /** 승인한 설정 바꾸기 (블로그 이름 · 소개): 결재마다 한 번 적용하고 결과(account.setting.changed)를 남긴다 */
  async applySetting(actor: Actor, change: SettingChangeInput): Promise<void> {
    const spaceId = SettingOutcome.spaceOf(actor, change.key);
    await SettingOutcome.settle(
      (work) => this.transaction(work),
      SettingOutcome.topicOf('account'),
      spaceId,
      change.key,
      async (tx) => {
        await new SpaceRepository(tx).save(await new SpaceEdit(tx, spaceId).apply(change));
      },
    );
  }

  private change(actor: Actor, version: number, apply: (space: Space) => void): Promise<Space> {
    actor.assertOwner();
    return this.transaction(async (tx) => {
      const spaces = new SpaceRepository(tx);
      const space = await spaces.lockCurrent();
      if (!space) throw new NotFound('블로그 공간부터 만들어 주세요 (설치 코드)');
      space.assertVersion(version);
      apply(space);
      await spaces.save(space);
      return space;
    });
  }
}
