import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  type Actor,
  ApprovedActor,
  BlobStore,
  Conflict,
  Database,
  EntityService,
  Forbidden,
  NotFound,
  RuleViolation,
  type Sql,
  SystemActor,
  type VersionInput,
  type VersionTarget,
  ZipLimits,
  ZipReader,
} from '../../platform';
import type { AppCodeVersionSource, AppRow } from '../blog.tables';
import { type PageFileEntry, PageFiles } from '../page/page-files';
import { AppCode } from './app-code';
import type {
  AppCodeBuiltInput,
  DeployedCodeInput,
  ShowCodeInput,
  UploadCodeInput,
} from './app-code.input';
import { AppCodeQuery } from './app-code.query';
import { AppCodeRepository } from './app-code.repository';
import { AppCodeBundle } from './app-code-bundle';
import type { AppCodeFiles } from './app-code-files';
import type { AppManifest } from './app-manifest';

// 앱 코드 쓰기 (스토어 1-6): 새 버전 쌓기(AI 작업의 결과 · zip 올리기 · 시작 코드로)와 보이는 버전 옮기기.
// 파일은 트랜잭션 밖에서 BlobStore에 먼저 쓰고, 트랜잭션 안에서는 앱을 잠가 버전 한 줄만 넣는다.
// 공개 앱의 새 버전은 확인 대기이고, 방문자에게 보이게 하는 것(show)은 관리자만 한다 (원칙 7). AI는 버전을 만들 뿐이다.
@Injectable()
export class AppCodeService extends EntityService<AppCode> {
  /** AI 작업의 결과물에서 묶음 전체로 읽는 zip의 이름 (폴더가 있는 빌드 결과) */
  static readonly BUILD_ZIP = 'app.zip';
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
    const before = await this.code.manifestOf(actor, base);
    let bundle: AppCodeBundle | null = null;
    let problem: string | null = null;
    try {
      // 결과물에 app.zip이 있으면 그 안이 묶음 전체다 (폴더가 있는 빌드 결과: 결과물은 폴더를 올리지 못한다, 스토어 9.13).
      // AI가 내용을 받지 못한 앞 버전의 파일(그림 · 큰 파일)은 zip에 없어도 남긴다. 없으면 가장 새 버전 위에 이번 파일을 얹는다
      const zipped = await this.zippedOf(req.files);
      bundle = zipped
        ? await this.unzipped(zipped, app.kind, AppCodeService.keptOf(base))
        : await this.fitting(AppCodeBundle.files(base.files.overlay(req.files)), base, app.kind);
      bundle.manifest.assertExtends(before);
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
    const app = await this.code.appOf(actor, actor.requireSpace(), req.id);
    if (app === null) throw new NotFound('앱을 찾을 수 없어요');
    const bundle = await this.unzipped(req.zip, app.kind);
    const latest = await this.code.filesOf(actor, app, app.code_versions);
    bundle.manifest.assertExtends(await this.code.manifestOf(actor, latest));
    return this.add(actor, req, bundle, 'upload', req.note);
  }

  /**
   * 배포 표로 받은 묶음을 새 버전으로 (PUT …/code/versions, cairn app deploy, 스토어 12.5). 요청자는 표다:
   * 표가 묶인 앱 · 크기 · sha256과 맞아야 하고, 표를 받은 뒤 다른 버전이 생겼으면 409.
   * AI가 만든 버전과 같은 규칙이다: 공개 앱은 확인 대기(관리자가 공개), 비공개 앱은 바로 보인다
   */
  async deployed(actor: Actor, req: DeployedCodeInput): Promise<AppCode> {
    const now = new Date();
    const ticket = await this.code.deployOf(actor, req.token, now);
    const sha256 = createHash('sha256').update(req.zip).digest('hex');
    if (ticket.appId !== req.id || ticket.size !== req.zip.length || ticket.sha256 !== sha256)
      throw new Forbidden('deploy_ticket', '배포 표와 다른 묶음이에요. 다시 배포해 주세요');
    const system = new SystemActor();
    const app = await this.code.appOf(system, ticket.spaceId, ticket.appId);
    if (app === null) throw new NotFound('앱을 찾을 수 없어요');
    const bundle = await this.unzipped(req.zip, app.kind);
    const latest = await this.code.filesOf(system, app, app.code_versions);
    bundle.manifest.assertExtends(await this.code.manifestOf(system, latest));
    return this.transaction(async (tx) => {
      const codes = this.store(tx);
      const code = await codes.lock(ticket.spaceId, app.id);
      if (code.latestSeq !== ticket.base)
        throw new Conflict('그사이 앱 코드가 바뀌었어요. 다시 배포해 주세요');
      code.add(bundle, 'upload', null, null, ticket.note || '배포', now);
      await codes.save(code);
      return code;
    });
  }

  /**
   * zip 하나를 묶음으로: 규칙에 맞는 묶음만 파일로 쓴다 (트랜잭션 밖에서, 파일이 먼저고 행이 나중이다).
   * kind를 주면 그 종류의 앱에 둘 수 있는지도 파일을 쓰기 전에 본다. kept: zip에 없으면 그대로 남길 앞 버전의 파일
   */
  private async unzipped(
    zip: Buffer,
    kind?: string,
    kept: readonly PageFileEntry[] = [],
  ): Promise<AppCodeBundle> {
    const files = AppCodeService.unzip(zip);
    const listed = AppCodeBundle.files([
      ...kept.filter((f) => !files.has(f.name)),
      ...[...files].map(([name, data]) => AppCodeService.entryOf(name, data)),
    ]);
    const manifest = files.get(AppCodeBundle.MANIFEST);
    const bundle = AppCodeBundle.of(listed, manifest ? manifest.toString('utf8') : null);
    if (kind !== undefined) bundle.assertFits(kind);
    for (const [name, data] of files) await this.blobs.save(data, PageFiles.typeOf(name));
    return bundle;
  }

  /** AI 작업의 결과물 가운데 app.zip의 내용. 없으면 null, 너무 크면 RuleViolation */
  private async zippedOf(files: unknown): Promise<Buffer | null> {
    const entry = (Array.isArray(files) ? files : []).find(
      (f) => (f as { name?: unknown } | null)?.name === AppCodeService.BUILD_ZIP,
    ) as { blobHash?: unknown; sizeBytes?: unknown } | undefined;
    if (!entry || typeof entry.blobHash !== 'string') return null;
    if (typeof entry.sizeBytes !== 'number' || entry.sizeBytes > AppCodeBundle.BYTES_MAX)
      throw new RuleViolation(
        `${AppCodeService.BUILD_ZIP}은 ${AppCodeBundle.BYTES_MAX / 1024 / 1024}MB까지예요`,
      );
    const chunks: Buffer[] = [];
    for await (const chunk of await this.blobs.open(entry.blobHash))
      chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks);
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

  /**
   * 대화의 결과 카드에서 승인한 공개 (task.approval.granted, 동작 blog.app_code.show, 스토어 1-6b). 승인한 결재만
   * (ApprovedActor). 지운 앱이면 아무것도 하지 않는다. 두 번 받아도 같다 (이미 보이면 그대로)
   */
  async showApproved(actor: Actor, appId: string, seq: number): Promise<void> {
    if (!(actor instanceof ApprovedActor) || actor.action !== AppCode.SHOW_ACTION)
      throw new Forbidden('approved', '승인한 공개만 할 수 있어요');
    const spaceId = actor.requireSpace();
    const app = await this.code.appOf(actor, spaceId, appId);
    if (app === null || seq < 1 || seq > app.code_versions) return;
    const manifest = await this.manifestAt(actor, app, seq);
    await this.transaction(async (tx) => {
      const codes = this.store(tx);
      const code = await codes.lockOrNull(spaceId, appId);
      if (code === null) return;
      code.showApproved(seq, new Date(), manifest);
      await codes.save(code);
    });
  }

  /** 이 버전 공개 (확인 대기 버전 · 앞 버전으로 되돌리기). 관리자만 */
  async show(actor: Actor, req: ShowCodeInput): Promise<AppCode> {
    actor.assertOwner();
    const app = await this.code.appOf(actor, actor.requireSpace(), req.id);
    if (app === null) throw new NotFound('앱을 찾을 수 없어요');
    const manifest = await this.manifestAt(actor, app, req.seq);
    return this.changeAsOwner(actor, req, (code) => code.show(req.seq, new Date(), manifest));
  }

  /** 버전 하나의 선언서 (보이게 할 때 앱 줄에 함께 둔다). 없는 버전이면 NotFound */
  private async manifestAt(actor: Actor, app: Readonly<AppRow>, seq: number): Promise<AppManifest> {
    return this.code.manifestOf(actor, await this.code.filesOf(actor, app, seq));
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

  /** bundleOf + 그 종류의 앱에 둘 수 있는지 (맞지 않으면 RuleViolation, 묶음을 돌려주지 않는다) */
  private async fitting(
    files: PageFiles,
    base: AppCodeFiles,
    kind: string,
  ): Promise<AppCodeBundle> {
    const bundle = await this.bundleOf(files, base);
    bundle.assertFits(kind);
    return bundle;
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
   * zip 풀기: 이름 → 내용. 폴더 하나로 감싼 zip이면 그 폴더를 벗긴다(dist/ 째로 묶은 빌드 결과). 운영체제가 넣는 파일은 건너뛴다.
   * 폴더가 든 이름은 그대로 두고, 폴더를 써도 되는 묶음인지는 AppCodeBundle이 본다 (정적 앱만, docs/스토어.md 9.13)
   */
  private static unzip(zip: Buffer): Map<string, Buffer> {
    const limits = new ZipLimits(
      PageFiles.NESTED_MAX * 2,
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
    for (const [name, data] of all) files.set(name.slice(strip.length), data);
    return files;
  }

  /** AI가 내용을 받지 못한 앞 버전의 파일 (시작 코드는 모두 글이라 없다) */
  private static keptOf(base: AppCodeFiles): PageFileEntry[] {
    if (base.isStarter) return [];
    const given = AppCodeQuery.givenOf(base.files);
    return base.files.toJSON().filter((f) => !given.has(f.name));
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
