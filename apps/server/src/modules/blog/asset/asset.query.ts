import type { Readable } from 'node:stream';
import { Injectable } from '@nestjs/common';
import {
  type Actor,
  BaseQuery,
  type Blob,
  BlobStore,
  Database,
  NotFound,
  SecretBox,
} from '../../platform';
import { App } from '../app/app';
import { AppTicket } from '../app-code/app-ticket';
import { Post } from '../post/post';
import type { ReadFileInput } from './asset.input';

/** 내보낼 파일 하나: 정보와 내용. open: 방문자도 볼 수 있는 파일인가 */
export class AssetFile {
  private static readonly OPEN_CACHE = 'public, max-age=31536000, immutable';
  private static readonly PRIVATE_CACHE = 'no-store';

  constructor(
    readonly blob: Blob,
    readonly stream: Readable,
    private readonly open: boolean,
  ) {}

  /** 이름이 내용의 해시라 공개 파일은 바뀌지 않는다 */
  get cacheControl(): string {
    return this.open ? AssetFile.OPEN_CACHE : AssetFile.PRIVATE_CACHE;
  }
}

// 사진 읽기. 공개·링크 공개 글의 사진은 누구나, 나머지는 주인만.
// 앱 코드 미리 보기 토큰이 있으면 그 앱의 공개·링크 공개 글의 사진도 (비공개 앱 미리 보기, 스토어 1-6b. 앱 화면의 데이터와 같은 범위).
// 임시·휴지통 글의 사진은 방문자에게 없는 파일과 똑같이 NotFound: 해시를 알아도 있는지조차 알 수 없게.
// 파일은 글마다 따로가 아니라 내용마다 하나라, 공개 글 하나에라도 붙어 있으면 공개다.
@Injectable()
export class AssetQuery extends BaseQuery {
  private static readonly MISSING = '파일을 찾을 수 없어요';

  constructor(
    db: Database,
    private readonly blobs: BlobStore,
    private readonly box: SecretBox,
  ) {
    super(db);
  }

  /** 넘긴 해시 중 사진 · 글 표지가 가리키는 것 (platform의 BlobStore.sweep이 묻는다. 휴지통 글의 것도 쓰는 것이다) */
  async usedBlobs(actor: Actor, hashes: readonly string[]): Promise<readonly string[]> {
    actor.assertOwnerOrSystem();
    const rows = await this.sql`
      SELECT blob_hash AS hash FROM blog.assets WHERE blob_hash = ANY(${hashes as string[]}::text[])
      UNION
      SELECT cover_blob_hash FROM blog.posts WHERE cover_blob_hash = ANY(${hashes as string[]}::text[])`;
    return rows.map((row) => String(row.hash));
  }

  async file(actor: Actor, req: ReadFileInput, now: Date): Promise<AssetFile> {
    const hash = req.hash;
    const open = await this.inOpenPost(hash);
    if (!open && actor.kind !== 'owner' && !(await this.inTicketApp(req, now)))
      throw new NotFound(AssetQuery.MISSING);
    const blob = await this.blobs.find(hash);
    if (!blob) throw new NotFound(AssetQuery.MISSING);
    return new AssetFile(blob, await this.blobs.open(hash), open);
  }

  /** 토큰의 앱에 든 공개·링크 공개 글의 사진인가. 틀린 · 끝난 토큰은 없는 파일과 같다 */
  private async inTicketApp(req: ReadFileInput, now: Date): Promise<boolean> {
    if (req.ticket === null) return false;
    const ticket = AppTicket.open(this.box, req.ticket, now);
    const [row] = await this.sql<{ open: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM blog.assets a JOIN blog.posts p ON p.id = a.post_id
        WHERE a.blob_hash = ${req.hash} AND p.deleted_at IS NULL
          AND p.status IN (${Post.PUBLISHED}, ${Post.UNLISTED}) AND p.app_id = ${ticket.appId}
      ) AS open`;
    return row?.open === true;
  }

  private async inOpenPost(hash: string): Promise<boolean> {
    const [row] = await this.sql<{ open: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM blog.assets a JOIN blog.posts p ON p.id = a.post_id
          JOIN blog.apps g ON g.id = p.app_id
        WHERE a.blob_hash = ${hash} AND p.deleted_at IS NULL
          AND p.status IN (${Post.PUBLISHED}, ${Post.UNLISTED}) AND g.visibility = ${App.PUBLIC}
      ) AS open`;
    return row?.open === true;
  }
}
