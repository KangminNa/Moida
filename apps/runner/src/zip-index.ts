import { inflateRawSync } from 'node:zlib';

/** zip 안의 파일 하나: 이름(폴더 포함) · 푼 크기 */
export class ZipEntry {
  constructor(
    readonly name: string,
    readonly size: number,
    private readonly method: number,
    private readonly packedSize: number,
    private readonly headerAt: number,
  ) {}

  /** 이름만 바꾼 같은 파일 (감싼 폴더를 벗길 때) */
  renamed(name: string): ZipEntry {
    return new ZipEntry(name, this.size, this.method, this.packedSize, this.headerAt);
  }

  /** 푼 내용. 모르는 압축 방식 · 깨진 자료 · max바이트 초과면 null */
  bytes(zip: Buffer, max: number): Buffer | null {
    if (this.size > max || this.headerAt + 30 > zip.length) return null;
    if (zip.readUInt32LE(this.headerAt) !== 0x04034b50) return null;
    const start =
      this.headerAt +
      30 +
      zip.readUInt16LE(this.headerAt + 26) +
      zip.readUInt16LE(this.headerAt + 28);
    const packed = zip.subarray(start, start + this.packedSize);
    if (packed.length !== this.packedSize) return null;
    if (this.method === 0) return Buffer.from(packed);
    if (this.method !== 8) return null;
    try {
      return inflateRawSync(packed, { maxOutputLength: max });
    } catch {
      return null;
    }
  }
}

// zip의 파일 목록 읽기 (스토어 9.13: 앱 코드 일의 app.zip을 서버에 올리기 전에 러너가 본다). 러너에는 런타임 의존 패키지가 없어
// 목록(central directory)만 직접 읽고, 내용은 node:zlib로 필요한 파일(moida.json)만 푼다. 서버(AppCodeService.unzip)와 같은 눈으로:
// 운영체제가 넣는 파일은 건너뛰고, 폴더 하나로 감싼 zip이면 그 폴더를 벗긴다. zip64 · 암호 · 나뉜 zip은 읽지 않는다 (null)
export class ZipIndex {
  private static readonly JUNK = /(^|\/)(__MACOSX\/|\.DS_Store$|Thumbs\.db$|desktop\.ini$)/i;
  private static readonly ENTRIES_MAX = 5000;

  private constructor(
    private readonly zip: Buffer,
    readonly entries: readonly ZipEntry[],
  ) {}

  static read(zip: Buffer): ZipIndex | null {
    const end = ZipIndex.endAt(zip);
    if (end < 0) return null;
    const count = zip.readUInt16LE(end + 10);
    let at = zip.readUInt32LE(end + 16);
    if (count === 0xffff || at === 0xffffffff || count > ZipIndex.ENTRIES_MAX) return null;
    const found: ZipEntry[] = [];
    for (let i = 0; i < count; i++) {
      if (at + 46 > zip.length || zip.readUInt32LE(at) !== 0x02014b50) return null;
      const flags = zip.readUInt16LE(at + 8);
      const nameLength = zip.readUInt16LE(at + 28);
      const name = zip.subarray(at + 46, at + 46 + nameLength).toString('utf8');
      // 암호가 걸린 파일은 읽지 않는다
      if (flags & 1) return null;
      if (!name.endsWith('/') && !ZipIndex.JUNK.test(name))
        found.push(
          new ZipEntry(
            name,
            zip.readUInt32LE(at + 24),
            zip.readUInt16LE(at + 10),
            zip.readUInt32LE(at + 20),
            zip.readUInt32LE(at + 42),
          ),
        );
      at += 46 + nameLength + zip.readUInt16LE(at + 30) + zip.readUInt16LE(at + 32);
    }
    const tops = new Set(found.map((e) => (e.name.includes('/') ? e.name.split('/')[0] : '')));
    const [top] = tops;
    const strip = tops.size === 1 && top !== undefined && top !== '' ? top.length + 1 : 0;
    return new ZipIndex(
      zip,
      found.map((e) => e.renamed(e.name.slice(strip))),
    );
  }

  /** 글 파일 하나의 내용. 없거나 풀 수 없거나 max바이트를 넘으면 null */
  text(name: string, max: number): string | null {
    const entry = this.entries.find((e) => e.name === name);
    return entry?.bytes(this.zip, max)?.toString('utf8') ?? null;
  }

  /** 끝 기록(end of central directory)의 자리. 없으면 -1 */
  private static endAt(zip: Buffer): number {
    const from = Math.max(0, zip.length - 22 - 0xffff);
    for (let at = zip.length - 22; at >= from; at--)
      if (zip.readUInt32LE(at) === 0x06054b50) return at;
    return -1;
  }
}
