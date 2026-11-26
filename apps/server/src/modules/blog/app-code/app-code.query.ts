import { Readable } from 'node:stream';
import { Injectable } from '@nestjs/common';
import {
  Actor,
  ApprovedActor,
  BaseQuery,
  BlobStore,
  Database,
  Leases,
  NotFound,
  RuleViolation,
  SecretBox,
  ZipFile,
} from '../../platform';
import { appCodeVersions, apps } from '../blog.schema';
import type { AppCodeVersionRow, AppRow } from '../blog.tables';
import type { PageFiles } from '../page/page-files';
import type {
  AppCodeBaseInput,
  AppCodeIdInput,
  CodeVersionInput,
  DeployCodeInput,
  PreviewCodeInput,
} from './app-code.input';
import {
  type AppCodeBaseFile,
  AppCodeBaseView,
  AppCodeChangesView,
  AppCodeDeployView,
  AppCodePreviewView,
  AppCodeVersionView,
  AppCodeView,
} from './app-code.view';
import { AppCodeBundle } from './app-code-bundle';
import { AppCodeFiles } from './app-code-files';
import { AppManifest } from './app-manifest';
import { AppStarterGateway } from './app-starter.gateway';
import { AppTicket } from './app-ticket';
import { DeployTicket } from './deploy-ticket';

/** 버전 하나를 묶은 zip (관리자의 내려받기) */
export class AppCodeArchive {
  constructor(
    readonly fileName: string,
    readonly bytes: Buffer,
  ) {}
}

// 앱 코드 읽기 (스토어 1-6). 관리자의 코드 탭 · 바뀐 점 · 미리 보기 주소 · zip 받기, 러너의 app_code_base.
// 버전의 파일 읽기(filesOf · textOf · hostsOf · open)는 방문자 화면(AppSiteQuery)과 쓰기(AppCodeService)도 함께 쓴다:
// 그 앱을 볼 수 있는지는 부르는 쪽이 이미 정했다.
@Injectable()
export class AppCodeQuery extends BaseQuery {
  private static readonly MISSING = '앱을 찾을 수 없어요';
  /** app_code_base가 내용까지 주는 글 파일과 그 크기의 합 (페이지의 page_base와 같다) */
  private static readonly TEXT = /\.(html?|css|m?js|json|md|txt|csv|svg|xml)$/i;
  private static readonly BASE_TEXT_MAX = 300 * 1024;
  /** 앱 화면 공개의 승인 동작 (검수하는 일이 이 동작이면 그 앱을 읽는다) */
  private static readonly SHOW = 'blog.app_code.show';

  constructor(
    db: Database,
    private readonly blobs: BlobStore,
    private readonly box: SecretBox,
    private readonly leases: Leases,
    private readonly starters: AppStarterGateway,
  ) {
    super(db);
  }

  /** 코드 탭: 지금 상태 · 버전 목록(새 버전부터) · 보이는 코드의 파일 · 바깥 주소. 관리자만 */
  async code(actor: Actor, req: AppCodeIdInput): Promise<AppCodeView> {
    const app = await this.owned(actor, req.id);
    const rows = await this.rows(appCodeVersions, { app_id: app.id }, { order: ['seq desc'] });
    const shown = await this.filesOf(actor, app, null);
    return new AppCodeView(
      app,
      rows.map((r) => new AppCodeVersionView(r, AppCodeBundle.files(r.files).toJSON())),
      shown.files.toJSON(),
      await this.hostsOf(actor, shown),
    );
  }

  /** 버전 하나의 바뀐 점: 앞 버전(버전 1이면 시작 코드)과 파일 · 바깥 주소 비교. 관리자만 */
  async changes(actor: Actor, req: CodeVersionInput): Promise<AppCodeChangesView> {
    const app = await this.owned(actor, req.id);
    if (req.seq < 1) throw new NotFound(`없는 버전이에요: ${req.seq}`);
    const after = await this.filesOf(actor, app, req.seq);
    const before = await this.filesOf(actor, app, req.seq - 1);
    return new AppCodeChangesView(
      req.seq,
      AppCodeBundle.diff(before.files, after.files),
      { before: await this.hostsOf(actor, before), after: await this.hostsOf(actor, after) },
      after.files.toJSON().reduce((sum, f) => sum + f.sizeBytes, 0),
    );
  }

  /** 미리 보기 주소 (토큰이 든 /<앱>/~<토큰>, 30분). seq가 없으면 보이는 버전, 0이면 시작 코드. 관리자만 */
  async preview(actor: Actor, req: PreviewCodeInput, now: Date): Promise<AppCodePreviewView> {
    const app = await this.owned(actor, req.id);
    if (req.seq !== null && req.seq > app.code_versions)
      throw new NotFound(`없는 버전이에요: ${req.seq}`);
    const token = new AppTicket(app.id, req.seq).seal(this.box, now);
    return new AppCodePreviewView(`/${app.slug}/${AppTicket.MARK}${token}`);
  }

  /** 버전 하나(0이면 시작 코드)의 zip. 파일 이름은 <앱 주소>-v<번호>.zip. 관리자만 */
  async zip(actor: Actor, req: CodeVersionInput): Promise<AppCodeArchive> {
    const app = await this.owned(actor, req.id);
    const code = await this.filesOf(actor, app, req.seq);
    const zip = new ZipFile();
    for (const f of code.files.toJSON()) zip.add(f.name, await this.bytesOf(actor, code, f.name));
    return new AppCodeArchive(`${app.slug}-v${req.seq}.zip`, zip.toBuffer());
  }

  /**
   * 러너가 쥔 만들기 일이 고칠 앱 (MCP app_code_base): 가장 새 버전(확인 대기 포함, 없으면 시작 코드)의 파일과 바깥 주소.
   * 앱 화면 공개를 검수하는 일(task의 payload.inspect, 2026-11-20)도 그 앱의 같은 코드를 읽는다.
   * 글 파일은 내용까지(모두 BASE_TEXT_MAX바이트까지), 그 밖은 이름 · 크기만. 앱 코드 주문이 없는 일이면 app_id null
   */
  async base(actor: Actor, req: AppCodeBaseInput): Promise<AppCodeBaseView> {
    actor.assertCan(Actor.RUN);
    const work = await this.leases.of(actor, req.taskId);
    const appId = AppCodeQuery.appOfWork(work.kind, work.payload);
    if (appId === null) return new AppCodeBaseView(null, 0, [], []);
    const app = await this.row(apps, { space_id: actor.requireSpace(), id: appId });
    if (!app) return new AppCodeBaseView(null, 0, [], []);
    const code = await this.filesOf(actor, app, app.code_versions);
    const given = AppCodeQuery.givenOf(code.files);
    const files: AppCodeBaseFile[] = [];
    for (const f of code.files.toJSON()) {
      const text = given.has(f.name) ? await this.textOf(actor, code, f.name, f.sizeBytes) : null;
      files.push({ name: f.name, size: f.sizeBytes, text });
    }
    return new AppCodeBaseView(app, code.seq, files, await this.hostsOf(actor, code));
  }

  /**
   * 러너가 내용까지 받는 파일의 이름: 글 파일을 목록 순서대로, 모두 BASE_TEXT_MAX바이트까지. 그 밖의 파일(그림 · 큰 파일)은
   * 이름 · 크기만 간다. AI가 묶음 전체(app.zip)를 낼 때 받지 못한 파일을 남기는 기준이기도 하다 (AppCodeService.built)
   */
  static givenOf(files: PageFiles): Set<string> {
    let budget = AppCodeQuery.BASE_TEXT_MAX;
    const given = new Set<string>();
    for (const f of files.toJSON()) {
      if (!AppCodeQuery.TEXT.test(f.name) || f.sizeBytes > budget) continue;
      budget -= f.sizeBytes;
      given.add(f.name);
    }
    return given;
  }

  /** 앱 한 줄 (쓰기 전에 읽기: 일꾼 · 관리자 · 승인한 앱 화면 공개). 없거나 다른 공간이면 null */
  async appOf(actor: Actor, spaceId: string, id: string): Promise<AppRow | null> {
    const approved = actor instanceof ApprovedActor && actor.action === AppCodeQuery.SHOW;
    if (!approved) actor.assertOwnerOrSystem();
    return this.row(apps, { space_id: spaceId, id });
  }

  /**
   * 배포 도구(MCP app_code_upload, write 기기 · cairn app deploy): 그 앱에 묶음을 올릴 표 (스토어 12.5).
   * 표는 그 앱 · 지금의 마지막 버전 · 크기 · sha256 · 메모에 묶인다 (10분)
   */
  async deployTicket(actor: Actor, req: DeployCodeInput, now: Date): Promise<AppCodeDeployView> {
    actor.assertCan(Actor.WRITE);
    const spaceId = actor.requireSpace();
    const app = await this.row(apps, { space_id: spaceId, slug: req.slug });
    if (app === null) throw new NotFound(AppCodeQuery.MISSING);
    const ticket = new DeployTicket(
      spaceId,
      app.id,
      app.code_versions,
      req.size,
      req.sha256,
      req.note,
    );
    return new AppCodeDeployView(
      ticket.path,
      DeployTicket.HEADER,
      ticket.seal(this.box, now),
      DeployTicket.expiresAt(now),
    );
  }

  /** 배포 표를 연다 (PUT …/code/versions). 없거나 · 틀리거나 · 끝났으면 403 */
  async deployOf(_actor: Actor, token: string | null, now: Date): Promise<DeployTicket> {
    return DeployTicket.open(this.box, token, now);
  }

  /**
   * 이름 있는 시작 화면 한 벌 (StarterCodeInput.template). 페이지 앱에만, 없는 이름이면 422
   */
  templateOf(_actor: Actor, app: Readonly<AppRow>, name: string): AppCodeFiles {
    const files = app.kind === 'page' ? this.starters.template(name) : null;
    if (!files) throw new RuleViolation('이 앱에 쓸 수 없는 시작 화면이에요');
    return AppCodeFiles.starter(files);
  }

  /**
   * 앱의 코드 한 벌. seq: null이면 방문자에게 보이는 버전(없으면 시작 코드), 0이면 시작 코드, 그 밖은 그 버전.
   * 없는 버전이면 NotFound
   */
  async filesOf(_actor: Actor, app: Readonly<AppRow>, seq: number | null): Promise<AppCodeFiles> {
    const wanted = seq ?? app.code_seq ?? AppCodeFiles.STARTER;
    if (wanted === AppCodeFiles.STARTER) return AppCodeFiles.starter(this.starters.files(app.kind));
    const row: Pick<AppCodeVersionRow, 'files'> | null = await this.row(
      appCodeVersions,
      { app_id: app.id, seq: wanted },
      { columns: ['files'] },
    );
    if (!row) throw new NotFound(`없는 버전이에요: ${wanted}`);
    return AppCodeFiles.stored(wanted, AppCodeBundle.files(row.files));
  }

  /** 글 파일 하나의 내용. 없거나 max바이트를 넘으면 null */
  async textOf(
    _actor: Actor,
    code: AppCodeFiles,
    name: string,
    max: number,
  ): Promise<string | null> {
    const file = code.files.find(name);
    if (!file || file.sizeBytes > max) return null;
    const starter = code.starterBytes(name);
    return starter ? starter.toString('utf8') : this.blobs.text(file.blobHash, max);
  }

  /** 이 코드의 바깥 주소 (cairn.json의 hosts). 저장할 때 검사한 값이라 읽을 수 없으면 비운다 */
  async hostsOf(actor: Actor, code: AppCodeFiles): Promise<readonly string[]> {
    return (await this.manifestOf(actor, code)).hosts;
  }

  /** 이 코드의 선언서 cairn.json (없거나 읽을 수 없으면 AppManifest.NONE: 바깥 주소 없음 · 템플릿) */
  async manifestOf(actor: Actor, code: AppCodeFiles): Promise<AppManifest> {
    const text = await this.textOf(
      actor,
      code,
      AppCodeBundle.MANIFEST,
      AppCodeBundle.MANIFEST_BYTES_MAX,
    );
    if (text === null) return AppManifest.NONE;
    try {
      return AppCodeBundle.manifestOf(text);
    } catch {
      return AppManifest.NONE;
    }
  }

  /** 파일 하나를 흘려보낸다. 없으면 NotFound */
  async open(_actor: Actor, code: AppCodeFiles, name: string): Promise<Readable> {
    if (!code.files.find(name)) throw new NotFound('없는 파일이에요');
    const starter = code.starterBytes(name);
    return starter
      ? Readable.from(starter)
      : this.blobs.open(code.files.find(name)?.blobHash ?? '');
  }

  /** hashes 가운데 버전이 가리키는 파일 (BlobStore.registerUse: 쓰는 동안 platform이 파일을 지우지 않게) */
  async usedBlobs(actor: Actor, hashes: readonly string[]): Promise<string[]> {
    actor.assertOwnerOrSystem();
    const rows = await this.sql<{ hash: string }[]>`
      SELECT DISTINCT f->>'blobHash' AS hash
      FROM blog.app_code_versions v, jsonb_array_elements(v.files) f
      WHERE f->>'blobHash' = ANY(${hashes as string[]}::text[])`;
    return rows.map((row) => row.hash);
  }

  /** 관리자의 앱 (같은 공간). 없으면 NotFound */
  /** 쥔 일이 보는 앱: 만들기 일의 앱 코드 주문(payload.appCode), 또는 앱 화면 공개를 검수하는 일(payload.inspect). 없으면 null */
  private static appOfWork(kind: string, payload: unknown): string | null {
    const p = payload as {
      appCode?: { appId?: unknown };
      inspect?: { action?: unknown; targetId?: unknown };
    } | null;
    const id =
      kind === 'make'
        ? p?.appCode?.appId
        : p?.inspect?.action === AppCodeQuery.SHOW
          ? p.inspect.targetId
          : null;
    return typeof id === 'string' ? id : null;
  }

  private async owned(actor: Actor, id: string): Promise<AppRow> {
    actor.assertOwner();
    const app = await this.row(apps, { space_id: actor.requireSpace(), id });
    if (!app) throw new NotFound(AppCodeQuery.MISSING);
    return app;
  }

  private async bytesOf(actor: Actor, code: AppCodeFiles, name: string): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of await this.open(actor, code, name)) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks);
  }
}
