import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { BaseGateway } from '../../platform';
import type { AppKind } from '../blog.tables';

// 앱 종류의 시작 코드 (스토어 1-6, docs/스토어.md 9장). 저장소 apps/server/starters/의 파일이고 서버 이미지에 함께 든다:
// 프로세스가 도는 동안 바뀌지 않아 처음 한 번 읽어 둔다. base/ 위에 종류 폴더(blog · magazine · community)를 얹은 것이 한 벌이다.
// 페이지 앱(스토어의 "화면만" 앱)은 블로그 틀 없이 자기 폴더만이다: 빈 정적 앱(cairn.json static)이고 화면 전체를 앱이 정한다
// (페이지 앱 P1 2026-11-20, 정적 시작 코드 2026-11-25 A4).
// 코드가 없는 앱은 이 한 벌로 보이고, 처음 고칠 때(AI 작업 · 시작 코드로) 그 앱의 버전 1로 복사된다.
export class AppStarterGateway extends BaseGateway {
  protected readonly name = '시작 코드';
  private static readonly BASE = 'base';
  /** base/를 얹지 않는 종류 */
  private static readonly ALONE: readonly AppKind[] = ['page'];
  /** 폴더 없는 파일 이름만 (PageFiles와 같은 규칙) */
  private static readonly NAME = /^[^/\\.][^/\\]{0,119}$/;
  private readonly cache = new Map<AppKind, ReadonlyMap<string, Buffer>>();

  constructor(private readonly dir: string) {
    super();
  }

  static fromEnv(): AppStarterGateway {
    return new AppStarterGateway(resolve(process.cwd(), 'starters'));
  }

  /** 종류의 시작 코드: 파일 이름 → 내용 (이름 순) */
  files(kind: AppKind): ReadonlyMap<string, Buffer> {
    const cached = this.cache.get(kind);
    if (cached) return cached;
    const base = AppStarterGateway.ALONE.includes(kind) ? [] : this.read(AppStarterGateway.BASE);
    const merged = new Map([...base, ...this.read(kind)]);
    const files = new Map([...merged].sort(([a], [b]) => a.localeCompare(b)));
    this.cache.set(kind, files);
    return files;
  }

  private read(folder: string): Map<string, Buffer> {
    const path = join(this.dir, folder);
    const names = existsSync(path) ? readdirSync(path) : [];
    return new Map(
      names
        .filter((n) => AppStarterGateway.NAME.test(n))
        .map((n) => [n, readFileSync(join(path, n))] as const),
    );
  }
}
