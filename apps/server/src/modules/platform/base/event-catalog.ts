import { Logger } from '@nestjs/common';
import type { DomainEvent } from './event';

/** 이벤트 목록 파일 하나 (<모듈>.events.json): 주제 → 칸(`이름?`은 없어도 됨) · 내도 되는 다른 모듈 */
interface EventsFile {
  readonly topics: Readonly<
    Record<string, { readonly fields: readonly string[]; readonly from?: readonly string[] }>
  >;
}

/** 주제 하나의 약속 */
class TopicSpec {
  constructor(
    /** 등록한 모듈 */
    readonly module: string,
    readonly required: readonly string[],
    readonly optional: readonly string[],
  ) {}

  /** 내용의 칸이 약속과 다르면 그 까닭 */
  problem(data: Readonly<Record<string, unknown>>): string | null {
    const keys = Object.keys(data);
    const missing = this.required.filter((k) => !keys.includes(k));
    const extra = keys.filter((k) => !this.required.includes(k) && !this.optional.includes(k));
    if (missing.length === 0 && extra.length === 0) return null;
    return [
      missing.length > 0 ? `빠진 칸 ${missing.join(', ')}` : '',
      extra.length > 0 ? `목록에 없는 칸 ${extra.join(', ')}` : '',
    ]
      .filter(Boolean)
      .join(' · ');
  }
}

// 이벤트 목록 (리팩토링 R3c): 모듈마다 <모듈>.events.json에 내보내는 주제와 칸을 적고, 시작할 때 define으로 등록한다.
// 받는 모듈은 다른 모듈의 주제를 글자로 적어 구독하므로(모듈을 가져오지 않는다), 오타와 칸이 어긋나는 것을 여기서 잡는다:
//   내보낼 때 (Outbox.publish)   목록에 없는 주제는 오류. 칸이 약속과 다르면 운영은 경고 로그, 그 밖(개발 · 시험)은 오류
//   일꾼이 시작할 때              구독 무늬(CoreWorkers · 알림)가 어느 주제에도 맞지 않으면 시작하지 않는다 (unknownPatterns)
// 플러그인의 주제(plugin.<스키마>.*)는 목록 파일의 확장 지점 검사(Work.record → manifest.emits)가 따로 막아 여기서는 넘긴다.
// 아무 목록도 등록되지 않은 프로세스(앱 없이 도는 단위 시험)에서는 검사하지 않는다.
// biome-ignore lint/complexity/noStaticOnlyClass: Outbox(트랜잭션마다 만든다)와 일꾼이 같은 목록을 보는 한 곳
export class EventCatalog {
  private static readonly PLUGIN = 'plugin.';
  private static readonly logger = new Logger('이벤트 목록');
  private static readonly topics = new Map<string, TopicSpec>();

  /**
   * 모듈이 시작할 때 자기 목록을 등록한다. 주제는 모듈 이름으로 시작해야 하고, 다른 모듈이 등록한 주제면 오류.
   * 같은 모듈이 다시 등록하면 바꾼다 (한 프로세스에 앱을 다시 띄우는 시험)
   */
  static define(module: string, file: EventsFile): void {
    for (const [topic, { fields }] of Object.entries(file.topics)) {
      if (!topic.startsWith(`${module}.`))
        throw new Error(`${module}의 이벤트 목록에 다른 모듈의 주제가 있어요: ${topic}`);
      const before = EventCatalog.topics.get(topic);
      if (before && before.module !== module)
        throw new Error(`${before.module}이 이미 등록한 이벤트 주제예요: ${topic}`);
      EventCatalog.topics.set(
        topic,
        new TopicSpec(
          module,
          fields.filter((f) => !f.endsWith('?')),
          fields.filter((f) => f.endsWith('?')).map((f) => f.slice(0, -1)),
        ),
      );
    }
  }

  /** 내보내기 전에: 목록에 없는 주제는 오류, 칸이 다르면 운영은 경고 · 그 밖은 오류 */
  static check(event: DomainEvent): void {
    if (EventCatalog.topics.size === 0 || event.name.startsWith(EventCatalog.PLUGIN)) return;
    const spec = EventCatalog.topics.get(event.name);
    if (!spec) throw new Error(`이벤트 목록에 없는 주제예요: ${event.name} (<모듈>.events.json)`);
    const problem = spec.problem(event.data);
    if (problem === null) return;
    const message = `${event.name}의 칸이 이벤트 목록과 달라요: ${problem}`;
    if (process.env.NODE_ENV === 'production') EventCatalog.logger.warn(message);
    else throw new Error(message);
  }

  /** 구독 무늬 가운데 어느 주제에도 맞지 않는 것 ('*'와 플러그인 주제의 무늬는 늘 맞는다) */
  static unknownPatterns(patterns: readonly string[]): readonly string[] {
    const topics = [...EventCatalog.topics.keys()];
    return [...new Set(patterns)].filter((pattern) => {
      if (pattern === '*' || pattern.startsWith(EventCatalog.PLUGIN)) return false;
      if (pattern.endsWith('.*')) return !topics.some((t) => t.startsWith(pattern.slice(0, -1)));
      return !EventCatalog.topics.has(pattern);
    });
  }
}
