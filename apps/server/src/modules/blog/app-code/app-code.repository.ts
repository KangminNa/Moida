import { TableRepository } from '../../platform';
import { appCodeVersions, apps } from '../blog.schema';
import type { AppRow } from '../blog.tables';
import { PageFiles } from '../page/page-files';
import { AppCode } from './app-code';

// blog.apps 한 줄의 코드 칸 ↔ AppCode. 버전(blog.app_code_versions)은 saveParts로 함께 넣는다 (추가만).
export class AppCodeRepository extends TableRepository<AppRow, AppCode> {
  protected readonly table = apps;
  protected readonly noun = '앱';

  protected toEntity(row: AppRow): AppCode {
    return AppCode.restore(row);
  }

  /** 그 실행이 만든 버전이 이미 있는가 (같은 이벤트를 두 번 받았을 때) */
  async hasRun(appId: string, runId: string): Promise<boolean> {
    return this.exists(appCodeVersions, { app_id: appId, run_id: runId });
  }

  /** 버전 하나의 파일 목록. 버전이 없으면 null */
  async filesOf(appId: string, seq: number): Promise<PageFiles | null> {
    const row = await this.row(appCodeVersions, { app_id: appId, seq }, { columns: ['files'] });
    return row ? PageFiles.of(row.files) : null;
  }

  protected override async saveParts(code: AppCode): Promise<void> {
    const version = code.addedVersion;
    if (version) await this.insertRows(appCodeVersions, version);
  }
}
