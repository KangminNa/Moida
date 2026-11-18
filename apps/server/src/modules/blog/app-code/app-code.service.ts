import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  type Actor,
  BlobStore,
  Conflict,
  Database,
  EntityService,
  NotFound,
  RuleViolation,
  type Sql,
  type VersionInput,
  type VersionTarget,
  ZipLimits,
  ZipReader,
} from '../../platform';
import type { AppCodeVersionSource } from '../blog.tables';
import { type PageFileEntry, PageFiles } from '../page/page-files';
import type { AppCode } from './app-code';
import type { AppCodeBuiltInput, ShowCodeInput, UploadCodeInput } from './app-code.input';
import { AppCodeQuery } from './app-code.query';
import { AppCodeRepository } from './app-code.repository';
import { AppCodeBundle } from './app-code-bundle';
import type { AppCodeFiles } from './app-code-files';

// 앱 코드 쓰기 (스토어 1-6): 새 버전 쌓기(AI 작업의 결과 · zip 올리기 · 시작 코드로)와 보이는 버전 옮기기.
// 파일은 트랜잭션 밖에서 BlobStore에 먼저 쓰고, 트랜잭션 안에서는 앱을 잠가 버전 한 줄만 넣는다.
// 공개 앱의 새 버전은 확인 대기이고, 방문자에게 보이게 하는 것(show)은 관리자만 한다 (원칙 7). AI는 버전을 만들 뿐이다.
@Injectable()
export class AppCodeService extends EntityService<AppCode> {
  /** zip에서 건너뛰는 이름: 운영체제가 몰래 넣는 파일 */
  private static readonly JUNK = /(^|\/)(__MACOSX\/|\.DS_Store$|Thumbs\.db$|desktop\.ini$)/i;

  constructor(
    db: Database,
    private readonly blobs: BlobStore,
    private readonly code: AppCodeQuery,
  ) {
    super(db);
  }

  protected store(tx: Sql): AppCodeRepository {
    return new AppCodeRepository(tx);
  }

  /**
   * 앱 코드를 고친 만들기 작업이 끝났다 (task.app_code.built, 일꾼이 부른다). 가장 새 버전(없으면 시작 코드) 위에
   * 이번 파일을 얹은 새 버전. 같은 이벤트를 두 번 받아도 버전은 하나다. 묶음 규칙에 맞지 않으면 버전을 만들지 않고
   * 까닭을 알린다 (blog.app_code.refused → 알림). 지운 앱이면 아무것도 하지 않는다
   */
  async built(actor: Actor, spaceId: string, req: AppCodeBuiltInput): Promise<void> {
    actor.assertOwnerOrSystem();
    const app = await this.code.appOf(actor, spaceId, req.appId);
    if (app === null) return;
    const base = await this.code.filesOf(actor, app, app.code_versions);
    let bundle: AppCodeBundle | null = null;
    let problem: string | null = null;
    try {
      bundle = await this.bundleOf(PageFiles.of(base.files.overlay(req.files)), base);
    } catch (error) {
      if (!(error instanceof RuleViolation)) throw error;
      problem = error.message;
    }
    await this.transaction(async (tx) => {
      const codes = this.store(tx);
      const code = await codes.lockOrNull(spaceId, app.id);
      if (code === null || (await codes.hasRun(app.id, req.runId))) return;
      // 파일을 읽는 사이에 다른 버전이 생겼다: 일꾼이 다시 부르면 새 바탕 위에 얹는다
      if (code.latestSeq !== app.code_versions)
        throw new Conflict('그사이 앱 코드가 바뀌었어요. 다시 만들어요');
      const now = new Date();
      if (bundle === null) code.refuse(req.taskId, problem ?? '', now);
      else code.add(bundle, 'task', req.taskId, req.runId, req.note, now);
      await codes.save(code);
    });
  }

  /** zip 올리기: 묶음 전체가 새 버전이 된다 (지운 파일은 새 버전에 없다). 관리자만 */
  async upload(actor: Actor, req: UploadCodeInput): Promise<AppCode> {
    actor.assertOwner();
    const files = AppCodeService.unzip(req.zip);
    const listed = PageFiles.of(
      [...files].map(([name, data]) => AppCodeService.entryOf(name, data)),
    );
    const manifest = files.get(AppCodeBundle.MANIFEST);
    const bundle = AppCodeBundle.of(listed, manifest ? manifest.toString('utf8') : null);
    // 규칙에 맞는 묶음만 파일로 쓴다 (트랜잭션 밖에서, 파일이 먼저고 행이 나중이다)
    for (const [name, data] of files) await this.blobs.save(data, PageFiles.typeOf(name));
    return this.add(actor, req, bundle, 'upload', req.note);
  }

  /** 종류의 시작 코드를 새 버전으로 (처음으로 되돌리기, 기록은 남는다). 관리자만 */
  async starter(actor: Actor, req: VersionInput): Promise<AppCode> {
    actor.assertOwner();
    const app = await this.code.appOf(actor, actor.requireSpace(), req.id);
    if (app === null) throw new NotFound('앱을 찾을 수 없어요');
    const starter = await this.code.filesOf(actor, app, 0);
    const bundle = await this.bundleOf(starter.files, starter);
    return this.add(actor, req, bundle, 'starter', '시작 코드');
  }

  /** 이 버전 공개 (확인 대기 버전 · 앞 버전으로 되돌리기). 관리자만 */
  show(actor: Actor, req: ShowCodeInput): Promise<AppCode> {
    return this.changeAsOwner(actor, req, (code) => code.show(req.seq, new Date()));
  }

  private add(
    actor: Actor,
    target: VersionTarget,
    bundle: AppCodeBundle,
    source: AppCodeVersionSource,
    note: string,
  ): Promise<AppCode> {
    return this.changeAsOwner(actor, target, (code) =>
      code.add(bundle, source, null, null, note, new Date()),
    );
  }

  /**
   * 새 버전이 될 목록의 묶음 규칙 검사. 바탕이 시작 코드면 그 파일을 BlobStore에 먼저 쓴다
   * (같은 내용이면 같은 해시라 목록이 그대로 맞는다). cairn.json은 BlobStore에서 읽는다
   */
  private async bundleOf(files: PageFiles, base: AppCodeFiles): Promise<AppCodeBundle> {
    if (base.isStarter)
      for (const f of base.files.toJSON()) {
        const bytes = base.starterBytes(f.name);
        if (bytes) await this.blobs.save(bytes, f.mime);
      }
    const manifest = files.find(AppCodeBundle.MANIFEST);
    const text = manifest
      ? await this.blobs.text(manifest.blobHash, AppCodeBundle.MANIFEST_BYTES_MAX)
      : null;
    return AppCodeBundle.of(files, text);
  }

  /**
   * zip 풀기: 이름 → 내용. 폴더 하나로 감싼 zip이면 그 폴더를 벗긴다. 운영체제가 넣는 파일은 건너뛰고,
   * 그 밖에 폴더가 남으면 거절한다 (지금은 폴더 없는 파일만, docs/스토어.md 9.2)
   */
  private static unzip(zip: Buffer): Map<string, Buffer> {
    const limits = new ZipLimits(
      PageFiles.MAX * 2,
      AppCodeBundle.BYTES_MAX,
      AppCodeBundle.BYTES_MAX,
    );
    const all = [...ZipReader.read(zip, limits)].filter(
      ([name]) => !AppCodeService.JUNK.test(name),
    );
    const tops = new Set(all.map(([name]) => (name.includes('/') ? name.split('/')[0] : '')));
    const [top] = tops;
    const strip = tops.size === 1 && top !== undefined && top !== '' ? `${top}/` : '';
    const files = new Map<string, Buffer>();
    for (const [name, data] of all) {
      const inner = name.slice(strip.length);
      if (inner.includes('/')) throw new RuleViolation(`폴더 없이 파일만 넣어 주세요: ${name}`);
      files.set(inner, data);
    }
    return files;
  }

  private static entryOf(name: string, data: Buffer): PageFileEntry {
    return {
      name,
      blobHash: createHash('sha256').update(data).digest('hex'),
      mime: PageFiles.typeOf(name),
      sizeBytes: data.length,
    };
  }
}
