import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { crc32, deflateRawSync } from 'node:zlib';
import { CliError } from './terminal';

// 폴더 하나를 zip으로 (moida app deploy가 빌드 결과를 올릴 때). Node 내장 모듈만 쓴다.
// 숨김 파일(.으로 시작) · node_modules · 링크는 넣지 않고 무엇을 뺐는지 알려 준다. 이름은 폴더 기준의 / 경로, 순서는 이름순,
// 시각은 고정이라 같은 폴더는 늘 같은 zip이 된다 (같은 묶음을 다시 올리면 서버가 같은 파일로 본다).
export class FolderZip {
  /** 서버가 받는 zip의 크기 (UploadCodeInput.MAX_BYTES) */
  static readonly MAX_BYTES = 20 * 1024 * 1024;
  private static readonly SKIP = /^(\.|node_modules$)/;
  /** 1980-01-01 00:00 (zip의 가장 이른 날짜) */
  private static readonly DOS_DATE = 0x0021;
  private static readonly UTF8 = 0x0800;
  private static readonly DEFLATE = 8;

  private constructor(
    readonly bytes: Buffer,
    /** 넣은 파일의 이름 */
    readonly names: readonly string[],
    /** 넣지 않은 것 (숨김 파일 · node_modules · 링크) */
    readonly skipped: readonly string[],
  ) {}

  static pack(dir: string): FolderZip {
    const names: string[] = [];
    const skipped: string[] = [];
    FolderZip.walk(dir, '', names, skipped);
    const parts: Buffer[] = [];
    const central: Buffer[] = [];
    let offset = 0;
    for (const name of names) {
      const data = readFileSync(join(dir, name));
      const packed = deflateRawSync(data);
      const file = Buffer.from(name, 'utf8');
      const sum = crc32(data);
      const local = Buffer.alloc(30);
      local.writeUInt32LE(0x04034b50, 0);
      local.writeUInt16LE(20, 4);
      local.writeUInt16LE(FolderZip.UTF8, 6);
      local.writeUInt16LE(FolderZip.DEFLATE, 8);
      local.writeUInt16LE(0, 10);
      local.writeUInt16LE(FolderZip.DOS_DATE, 12);
      local.writeUInt32LE(sum, 14);
      local.writeUInt32LE(packed.length, 18);
      local.writeUInt32LE(data.length, 22);
      local.writeUInt16LE(file.length, 26);
      const entry = Buffer.alloc(46);
      entry.writeUInt32LE(0x02014b50, 0);
      entry.writeUInt16LE(20, 4);
      entry.writeUInt16LE(20, 6);
      entry.writeUInt16LE(FolderZip.UTF8, 8);
      entry.writeUInt16LE(FolderZip.DEFLATE, 10);
      entry.writeUInt16LE(0, 12);
      entry.writeUInt16LE(FolderZip.DOS_DATE, 14);
      entry.writeUInt32LE(sum, 16);
      entry.writeUInt32LE(packed.length, 20);
      entry.writeUInt32LE(data.length, 24);
      entry.writeUInt16LE(file.length, 28);
      entry.writeUInt32LE(offset, 42);
      parts.push(local, file, packed);
      central.push(entry, file);
      offset += local.length + file.length + packed.length;
      if (offset > FolderZip.MAX_BYTES)
        throw new CliError(`묶음이 너무 커요 (zip ${FolderZip.MAX_BYTES / 1024 / 1024}MB까지)`);
    }
    const directory = Buffer.concat(central);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(names.length, 8);
    end.writeUInt16LE(names.length, 10);
    end.writeUInt32LE(directory.length, 12);
    end.writeUInt32LE(offset, 16);
    return new FolderZip(Buffer.concat([...parts, directory, end]), names, skipped);
  }

  private static walk(root: string, under: string, names: string[], skipped: string[]): void {
    const entries = readdirSync(join(root, under)).sort();
    for (const entry of entries) {
      const name = under ? `${under}/${entry}` : entry;
      const stat = lstatSync(join(root, name));
      if (
        FolderZip.SKIP.test(entry) ||
        stat.isSymbolicLink() ||
        !(stat.isFile() || stat.isDirectory())
      )
        skipped.push(name);
      else if (stat.isDirectory()) FolderZip.walk(root, name, names, skipped);
      else names.push(name);
    }
  }
}
