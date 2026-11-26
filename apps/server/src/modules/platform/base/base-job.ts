/**
 * 기능 패키지의 반복 작업이 자기 동작(allow = Operation.SYSTEM)을 서버 자신으로 부르는 길 (플러그인 API 0.13):
 * 쓰기 동작이면 트랜잭션 하나. 바깥 호출은 동작과 동작 사이(트랜잭션 밖)에서 한다
 */
export type OwnCall = (operation: string, input: object) => Promise<unknown>;

// 일꾼이 정해진 간격마다 돌리는 일. 앞의 실행이 끝나지 않았으면 이번 차례는 건너뛴다.
export abstract class BaseJob {
  /** 목록 파일의 `job:<이름>`과 같아야 한다 */
  abstract readonly name: string;
  /** own: 기능 패키지의 반복 작업이면 자기 동작을 부르는 길 (코어의 반복 작업은 쓰지 않는다) */
  abstract run(own: OwnCall): Promise<void>;
}
