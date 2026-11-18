import { TableEntity } from '../../platform';
import type { AppMarkNew, AppMarkRow } from '../vault.tables';
import type { AppEventInput } from './app-mark.input';

/** app_marks 한 줄. 앱 하나에 한 행이라 엔티티의 id는 앱 id다 */
export interface LoadedAppMark extends AppMarkRow {
  id: string;
}

// 앱 공개 여부 사본 (스토어 1-2). vault는 blog를 읽지 않고 blog.app.changed로 앱이 공개인지만 안다.
// 방문자 그래프의 글은 든 앱의 사본이 공개여야 보인다. 이벤트 순서가 바뀌어도 appVersion이 더 큰 것만 반영하고,
// 지운 앱은 비공개로 남겨 늦게 온 "공개" 이벤트가 되살리지 못하게 한다.
export class AppMark extends TableEntity<LoadedAppMark, AppMarkNew & { id: string }> {
  /** 처음 본 앱 */
  static open(spaceId: string, event: AppEventInput, now: Date): AppMark {
    const mark = new AppMark(
      { id: event.appId, app_id: event.appId, space_id: spaceId, public: false, app_version: 0 },
      true,
    );
    mark.receive(event, now);
    return mark;
  }

  static restore(row: LoadedAppMark): AppMark {
    return new AppMark(row);
  }

  /** 사본 한 줄. 저장은 늘 통째로 맞춘다 (Repository가 읽는다) */
  get copy(): Readonly<LoadedAppMark> {
    return this.row;
  }

  /** 앱 이벤트를 받는다. 이미 본 버전보다 크지 않으면 그대로 */
  receive(event: AppEventInput, now: Date): void {
    if (event.appVersion <= this.row.app_version) return;
    this.put('public', !event.deleted && event.isPublic);
    this.put('app_version', event.appVersion);
    this.put('updated_at', now);
  }
}
