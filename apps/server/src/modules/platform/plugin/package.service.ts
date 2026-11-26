import { Injectable } from '@nestjs/common';
import { type Actor, VisitorActor } from '../base/actor';
import { BaseService } from '../base/base-service';
import type { ToolAnswer } from '../base/base-tool';
import { Database } from '../base/database';
import { NotFound } from '../base/errors';
import { Work } from '../base/operation';
import { Outbox } from '../base/outbox';
import { Lookups } from '../directory/lookups';
import { Leases } from './leases';
import { PluginChats } from './plugin-chats';
import type { PackageOperation } from './plugin-context';
import { PluginRegistry } from './plugin-registry';

// 기능 패키지의 동작을 돌리는 곳 (REST · MCP 입구가 함께 부른다). 순서는 여기 한 곳에서 지킨다:
// 권한 → 입력 모양 → 일(쓰기면 트랜잭션 하나, 남긴 이벤트는 같은 트랜잭션의 outbox로) → View.
// 동작 중인 패키지(켜졌고 허락한 확장 지점 안)의 동작만 찾는다. 꺼지면 경로 · 도구가 바로 없는 것과 같다.
@Injectable()
export class PackageService extends BaseService {
  /** 기능 패키지가 물을 수 있는 코어의 읽기 (플러그인 API 0.13). 방문자에게 보이는 것만 돌려주는 종류만 둔다 */
  static readonly LOOKUPS: readonly string[] = ['app', 'app-id', 'app-url'];
  constructor(
    db: Database,
    private readonly registry: PluginRegistry,
    private readonly leases: Leases,
    private readonly chats: PluginChats,
    private readonly lookups: Lookups,
  ) {
    super(db);
  }

  /** REST: /api/p/<패키지>/<경로>. 경로의 :id 같은 값은 입력에 더한다 */
  call(
    actor: Actor,
    plugin: string,
    method: string,
    path: string,
    raw: object,
    place: string | null = null,
  ): Promise<ToolAnswer> {
    const at = this.registry.operationAt(plugin, method, path);
    if (!at) throw new NotFound(`없는 경로예요: ${method} /api/p/${plugin}/${path}`);
    return this.run(actor, at.found, { ...raw, ...at.params }, place);
  }

  /** 동작 하나를 순서대로 돌린다. place: REST로 온 요청의 곳 (플러그인 API 0.11, MCP는 null) */
  async run(
    actor: Actor,
    found: PackageOperation,
    raw: unknown,
    place: string | null = null,
  ): Promise<ToolAnswer> {
    const { operation, manifest } = found;
    operation.check(actor);
    const input = operation.input(raw);
    const emits = (name: string) => manifest.emits(name);
    const leased = (id: string) => this.leases.of(actor, id);
    // 코어의 읽기 (0.13): 허락받은 종류만, 방문자의 눈으로 (공개된 것만)
    const lookup = (kind: string, ids: readonly string[]) => {
      if (!PackageService.LOOKUPS.includes(kind) || !manifest.allows(`lookup:${kind}`))
        throw new Error(`허락받지 않은 코어의 읽기예요: ${kind} (uses에 lookup:${kind})`);
      return this.lookups.visible(kind, new VisitorActor(), ids);
    };
    if (!operation.writes)
      return operation.run(
        new Work(this.db.sql, manifest.schema, emits, leased, null, place, lookup),
        actor,
        input,
      );
    return this.transaction(async (tx) => {
      // 대화 입구 (0.10): 허락받은 쓰기 동작만, 같은 트랜잭션에서
      const chat = manifest.allows('chat')
        ? (spaceId: string, chatId: string | null, requestId: string, text: string) =>
            this.chats.send(tx, spaceId, chatId, requestId, text)
        : null;
      const work = new Work(tx, manifest.schema, emits, leased, chat, place, lookup);
      const answer = await operation.run(work, actor, input);
      await new Outbox(tx).publish(work.events);
      return answer;
    });
  }
}
