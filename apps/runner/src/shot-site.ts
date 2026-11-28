import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname } from 'node:path';
import { SHOT_LIBRARY } from './shot-library';

// 결과 화면 찍기의 웹 서버 (2026-11-28). 묶음의 파일을 메모리에 들고 127.0.0.1의 빈 포트에서만 답한다 (찍는 동안만 뜬다).
// _/moida.js(옛 이름 _/cairn.js)는 예시 데이터로 채운 것(SHOT_LIBRARY). 그림처럼 내용을 받지 못한 파일(앞 버전의 그림)은
// 1×1 투명 그림이나 빈 글로 답한다: 묶음에는 있으니 찍기가 "없는 파일"로 세지 않게. 그 밖의 경로는 404
export class ShotSite {
  private static readonly TYPES: Readonly<Record<string, string>> = {
    '.html': 'text/html; charset=utf-8',
    '.htm': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.avif': 'image/avif',
    '.ico': 'image/x-icon',
    '.woff2': 'font/woff2',
    '.woff': 'font/woff',
    '.txt': 'text/plain; charset=utf-8',
    '.md': 'text/plain; charset=utf-8',
  };
  private static readonly LIBRARY = new Set(['_/moida.js', '_/cairn.js']);
  /** 1×1 투명 PNG */
  private static readonly PIXEL = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    'base64',
  );

  private constructor(
    private readonly server: Server,
    /** http://127.0.0.1:<포트> */
    readonly origin: string,
  ) {}

  /** files: 묶음 안의 경로 → 내용. known: 내용 없이 있는 것만 아는 파일 */
  static async open(
    files: ReadonlyMap<string, Buffer>,
    known: ReadonlySet<string>,
  ): Promise<ShotSite> {
    const server = createServer((req, res) => {
      const name = ShotSite.nameOf(req.url ?? '/');
      const type = ShotSite.TYPES[extname(name).toLowerCase()] ?? 'application/octet-stream';
      const send = (status: number, body: Buffer | string, as = type) => {
        res.writeHead(status, { 'content-type': as, 'cache-control': 'no-store' });
        res.end(body);
      };
      if (ShotSite.LIBRARY.has(name)) return send(200, SHOT_LIBRARY, ShotSite.TYPES['.js']);
      const body = files.get(name);
      if (body !== undefined) return send(200, body);
      if (known.has(name)) return send(200, type.startsWith('image/') ? ShotSite.PIXEL : '');
      return send(404, 'not found', 'text/plain; charset=utf-8');
    });
    await new Promise<void>((done, fail) => {
      server.once('error', fail);
      server.listen(0, '127.0.0.1', () => done());
    });
    const { port } = server.address() as AddressInfo;
    return new ShotSite(server, `http://127.0.0.1:${port}`);
  }

  /** 주소의 경로 → 묶음 안의 이름. 폴더(/로 끝남)는 그 안의 index.html, 쿼리 · 조각은 뗀다 */
  static nameOf(url: string): string {
    const path = url.split(/[?#]/)[0] ?? '/';
    let name: string;
    try {
      name = decodeURIComponent(path);
    } catch {
      return '';
    }
    name = name.replace(/^\/+/, '');
    return name === '' || name.endsWith('/') ? `${name}index.html` : name;
  }

  async close(): Promise<void> {
    this.server.closeAllConnections();
    await new Promise<void>((done) => this.server.close(() => done()));
  }
}
