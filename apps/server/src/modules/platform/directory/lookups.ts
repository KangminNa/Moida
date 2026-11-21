import { Injectable } from '@nestjs/common';
import type { Actor } from '../base/actor';
import { NotFound } from '../base/errors';

/** 종류 하나의 읽기: ids 가운데 요청자가 볼 수 있는 것의 id → 제목 (볼 수 없거나 없는 것은 빠진다) */
type LookupRead = (actor: Actor, ids: readonly string[]) => Promise<ReadonlyMap<string, string>>;

// 모듈 사이 읽기 (리팩토링 R3b, docs/리팩토링계획.md 7장): 다른 모듈의 것을 id로 확인할 때 그 모듈을 가져오지 않고 여기서 묻는다.
// 예: 글이 가리킬 wiki를 blog가 확인한다 (vault가 'wiki'를 등록). 가진 모듈이 시작할 때 종류마다 한 번 등록하고,
// platform은 무엇의 id인지 모른다 (LibraryQuery와 같은 방식). 방문자도 묻는다: 볼 수 있는지는 등록한 모듈이 거른다.
// 등록과 쓰는 곳은 apps/server/modules.json의 lookups(provides · asks)에 적고 경계 검사가 맞춰 본다. 트랜잭션 밖에서 묻는다
@Injectable()
export class Lookups {
  private readonly reads = new Map<string, LookupRead>();

  /** 그 종류를 가진 모듈이 한 번 등록한다 */
  provide(kind: string, read: LookupRead): void {
    if (this.reads.has(kind)) throw new Error(`이미 등록한 읽기예요: ${kind}`);
    this.reads.set(kind, read);
  }

  /** ids 가운데 볼 수 있는 것의 id → 제목. 등록한 모듈이 없으면 오류 (서버 구성이 틀렸다) */
  async visible(
    kind: string,
    actor: Actor,
    ids: readonly string[],
  ): Promise<ReadonlyMap<string, string>> {
    const read = this.reads.get(kind);
    if (!read) throw new Error(`읽기를 등록한 모듈이 없어요: ${kind}`);
    return ids.length === 0 ? new Map() : read(actor, ids);
  }

  /** 모두 볼 수 있어야 한다. 하나라도 없으면 NotFound(문구): 볼 수 없는 것은 없는 것과 같다 */
  async assertVisible(
    kind: string,
    actor: Actor,
    ids: readonly string[],
    notFound: string,
  ): Promise<void> {
    const seen = await this.visible(kind, actor, ids);
    if (ids.some((id) => !seen.has(id))) throw new NotFound(notFound);
  }
}
