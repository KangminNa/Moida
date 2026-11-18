import { RuleViolation } from '../../platform';
import { AppCodeOrder } from './app-code-order';
import { PageOrder } from './page-order';

// 만들기 작업의 결과를 blog로 내보내는 주문 (결과물 묶음 → 이벤트): 페이지(payload.page)와 앱 코드(payload.appCode, 스토어 1-6).
// 둘 다 만들기 일에만 적고, 한 작업에는 하나만. 작업이 끝나면 Task.submit이 그 주문으로 결과물을 검사하고 알린다.
// biome-ignore lint/complexity/noStaticOnlyClass: 두 주문의 규칙을 한 곳에서 묻는 입구
export class MakeOrder {
  /** 새 작업의 payload 검사. 틀리면 RuleViolation */
  static check(kind: string, make: string, payload: unknown): void {
    const page = PageOrder.of(payload);
    const code = AppCodeOrder.of(payload);
    if (page !== null && kind !== make)
      throw new RuleViolation('페이지(page)는 만들기 일에만 적어요');
    if (code !== null && kind !== make)
      throw new RuleViolation('앱 코드(appCode)는 만들기 일에만 적어요');
    if (page !== null && code !== null)
      throw new RuleViolation('페이지(page)와 앱 코드(appCode)는 함께 적지 않아요');
  }

  /** payload의 주문. 없으면 null */
  static of(payload: unknown): PageOrder | AppCodeOrder | null {
    return PageOrder.of(payload) ?? AppCodeOrder.of(payload);
  }
}
