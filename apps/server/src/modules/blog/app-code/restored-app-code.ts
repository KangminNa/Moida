import { createHash } from 'node:crypto';
import { ArchiveBlob, type ArchiveFile, BaseEntity, RuleViolation } from '../../platform';
import type { AppCodeVersionNew } from '../blog.tables';
import { type PageFileEntry, PageFiles } from '../page/page-files';
import { AppCodeBundle } from './app-code-bundle';

// 보관 파일의 앱 코드 (스토어 1-6c, docs/보관형식.md): blog/apps/<앱 주소>/code/<파일>은 백업할 때 방문자에게 보이던 버전의 파일이다.
// 복원하면 그 앱의 버전 1(source restore)이 되어 바로 보인다. 버전 기록과 확인 대기 버전은 싣지 않는다 (코드는 지금 모양이 곧 앱이다).
// 파일은 사람이 올리거나 AI가 만든 것이라 믿지 않는다: 저장할 때와 같은 묶음 규칙(AppCodeBundle)을 지나야 들어온다.
export class RestoredAppCode {
  static readonly PATH = /^blog\/apps\/([^/]+)\/code\/([^/]+)$/;
  /** 복원한 코드의 버전 번호 · 출처 */
  private static readonly SEQ = 1;
  private static readonly SOURCE = 'restore';

  private constructor(
    /** 이 코드를 쓰는 앱의 주소 */
    readonly slug: string,
    private readonly files: PageFiles,
    /** 파일의 내용 (복원이 BlobStore에 먼저 저장한다) */
    readonly blobs: readonly ArchiveBlob[],
  ) {}

  /** 보관 파일 가운데 앱 코드를 앱 주소마다 묶는다. 묶음 규칙에 맞지 않으면 RuleViolation (어느 앱인지 붙여) */
  static read(files: readonly ArchiveFile[]): ReadonlyMap<string, RestoredAppCode> {
    const grouped = new Map<string, ArchiveFile[]>();
    for (const file of files) {
      const slug = RestoredAppCode.PATH.exec(file.path)?.[1];
      if (slug !== undefined) grouped.set(slug, [...(grouped.get(slug) ?? []), file]);
    }
    const codes = new Map<string, RestoredAppCode>();
    for (const [slug, group] of grouped) codes.set(slug, RestoredAppCode.of(slug, group));
    return codes;
  }

  private static of(slug: string, group: readonly ArchiveFile[]): RestoredAppCode {
    const entries: PageFileEntry[] = [];
    const blobs: ArchiveBlob[] = [];
    let manifest: string | null = null;
    for (const file of group) {
      const name = RestoredAppCode.PATH.exec(file.path)?.[2] ?? '';
      const mime = PageFiles.typeOf(name);
      const blobHash = createHash('sha256').update(file.body).digest('hex');
      entries.push({ name, blobHash, mime, sizeBytes: file.body.length });
      blobs.push(new ArchiveBlob(file.body, mime));
      if (name === AppCodeBundle.MANIFEST && file.body.length <= AppCodeBundle.MANIFEST_BYTES_MAX)
        manifest = file.body.toString('utf8');
    }
    try {
      const files = PageFiles.of(entries.sort((a, b) => (a.name < b.name ? -1 : 1)));
      AppCodeBundle.of(files, manifest);
      return new RestoredAppCode(slug, files, blobs);
    } catch (error) {
      if (error instanceof RuleViolation)
        throw new RuleViolation(`앱 ${slug}의 코드: ${error.message}`);
      throw error;
    }
  }

  /** 버전 1 행 (복원한 앱의 code_seq · code_versions는 1이 된다). 만든 때는 복원한 때다 */
  versionRow(appId: string, spaceId: string): AppCodeVersionNew {
    return {
      id: BaseEntity.newId(),
      app_id: appId,
      space_id: spaceId,
      seq: RestoredAppCode.SEQ,
      files: this.files.toJSON(),
      source: RestoredAppCode.SOURCE,
    };
  }

  /** 복원한 앱 행에 더할 코드 칸: 이 버전이 보이는 버전이다 */
  static readonly SHOWN = { code_seq: RestoredAppCode.SEQ, code_versions: RestoredAppCode.SEQ };
}
