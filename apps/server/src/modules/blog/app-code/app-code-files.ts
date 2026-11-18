import { createHash } from 'node:crypto';
import { type PageFileEntry, PageFiles } from '../page/page-files';

// 앱 하나가 지금 쓰는 코드 파일들 (스토어 1-6): 저장한 버전 하나이거나, 아직 버전이 없으면 종류의 시작 코드.
// 둘 다 같은 목록 모양(PageFiles: 이름 · 해시 · 형식 · 크기)이다. 시작 코드의 해시는 내용의 sha256이라
// 버전 1로 복사할 때 BlobStore에 저장하면 같은 해시가 된다. 내용은 저장한 버전이면 BlobStore에서, 시작 코드면 여기서 읽는다.
export class AppCodeFiles {
  /** 시작 코드의 버전 번호 (버전은 1부터) */
  static readonly STARTER = 0;

  private constructor(
    /** 버전 번호. 0 = 종류의 시작 코드 */
    readonly seq: number,
    readonly files: PageFiles,
    private readonly bytes: ReadonlyMap<string, Buffer> | null,
  ) {}

  static stored(seq: number, files: PageFiles): AppCodeFiles {
    return new AppCodeFiles(seq, files, null);
  }

  /** 시작 코드 (저장소의 파일 이름 → 내용) */
  static starter(files: ReadonlyMap<string, Buffer>): AppCodeFiles {
    const entries: PageFileEntry[] = [...files].map(([name, data]) => ({
      name,
      blobHash: createHash('sha256').update(data).digest('hex'),
      mime: PageFiles.typeOf(name),
      sizeBytes: data.length,
    }));
    return new AppCodeFiles(AppCodeFiles.STARTER, PageFiles.of(entries), files);
  }

  get isStarter(): boolean {
    return this.bytes !== null;
  }

  /** 시작 코드 파일의 내용. 저장한 버전이면 null: 내용은 BlobStore에 있다 */
  starterBytes(name: string): Buffer | null {
    return this.bytes?.get(name) ?? null;
  }
}
