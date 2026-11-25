import { AttemptLimiter, NotFound, TooManyRequests } from '../../../apps/server/src/plugin-api';
import type { MapSearchGateway } from './map-search.gateway';

/**
 * 찾기 한 번의 문지기 (docs/지도.md MP-2): 곳마다 분당 상한 → 같은 질문 10분 기억 → 하루 상한 → 회사 부르기.
 * 기억은 서버 메모리에만 둔다 (회사 약관이 결과 저장을 막거나 기간을 정한다: 구글 좌표 30일, 카카오 · 네이버는 확인 전).
 * 하루 횟수도 메모리라 서버를 다시 켜면 0부터 센다: 그래서 기본 상한을 무료량의 절반쯤으로 둔다.
 * 설정을 바꾸면 플러그인이 다시 등록되므로 셈은 클래스에 둔다 (다시 등록해도 오늘 쓴 횟수가 남게)
 */
export class MapLookup {
  /** 곳(IP)마다 1분에 부를 수 있는 수 (기억에서 꺼낸 것도 센다: 찔러보기를 막는다) */
  static readonly PER_MINUTE = 30;
  static readonly REMEMBER_MS = 10 * 60_000;
  static readonly REMEMBER_MAX = 500;
  private static readonly places = new AttemptLimiter(MapLookup.PER_MINUTE, 60_000);
  private static readonly remembered = new Map<string, { at: number; value: unknown }>();
  private static spent = { day: '', count: 0 };

  constructor(
    /** 찾기 회사. 설정의 searchProvider가 none이거나 서버 키가 비면 null */
    private readonly gateway: MapSearchGateway | null,
    private readonly provider: string,
    private readonly dailyLimit: number,
  ) {}

  /** 이 회사로 같은 질문을 10분 안에 다시 하면 기억한 답, 아니면 하루 상한을 세고 회사에 묻는다 */
  async answer<T>(
    place: string | null,
    key: string,
    ask: (gateway: MapSearchGateway) => Promise<T>,
    now: number = Date.now(),
  ): Promise<T> {
    if (!this.gateway)
      throw new NotFound('지도 찾기를 켜지 않았어요 (지도 플러그인의 장소 · 주소 찾기)');
    MapLookup.places.hit(place ?? 'unknown', now);
    const full = `${this.provider}:${key}`;
    const kept = MapLookup.remembered.get(full);
    if (kept && now - kept.at < MapLookup.REMEMBER_MS) return kept.value as T;
    this.spend(now);
    const value = await ask(this.gateway);
    MapLookup.remember(full, value, now);
    return value;
  }

  /** 오늘(UTC) 회사를 부른 수 (플러그인 화면, MP-3) */
  static spentToday(now: number = Date.now()): number {
    return MapLookup.spent.day === MapLookup.day(now) ? MapLookup.spent.count : 0;
  }

  private spend(now: number): void {
    const day = MapLookup.day(now);
    if (MapLookup.spent.day !== day) MapLookup.spent = { day, count: 0 };
    if (MapLookup.spent.count >= this.dailyLimit)
      throw new TooManyRequests('오늘 지도 찾기 한도를 다 썼어요. 내일 다시 찾을 수 있어요');
    MapLookup.spent.count += 1;
  }

  private static remember(key: string, value: unknown, now: number): void {
    const kept = MapLookup.remembered;
    kept.delete(key);
    kept.set(key, { at: now, value });
    // 가장 오래 묻지 않은 것부터 지운다 (Map은 넣은 순서)
    while (kept.size > MapLookup.REMEMBER_MAX) {
      const oldest = kept.keys().next().value;
      if (oldest === undefined) break;
      kept.delete(oldest);
    }
  }

  private static day(now: number): string {
    return new Date(now).toISOString().slice(0, 10);
  }
}
