import type { INestApplication, INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { InstallPolicy, ServerRunnerGateway, SpaceQuery } from './modules/account';
import { HttpSetup, OutboxWorker, type RequestLogSink, SystemActor } from './modules/platform';

/** 서버를 띄우는 방법. 시험은 빈 포트 · 이 컴퓨터 · 조용히 · 신호 훅 없이(한 프로세스에 앱 여럿) */
interface ApiOptions {
  port?: number;
  host?: string;
  /** 요청 로그를 받을 곳 (기본: 서버 로그) */
  log?: RequestLogSink;
  /** Nest의 로그를 끈다 */
  quiet?: boolean;
  /** 종료 신호(SIGTERM)에 내려가는 훅 (기본 켬) */
  signals?: boolean;
}

// 시작 코드 한 곳 (리팩토링 6단계): 서버 · 일꾼 · 명령줄 · API 시험이 같은 길로 Nest 앱을 만든다.
// 시험에서 도는 서버가 운영의 서버와 같은 설정(본문 한도 · 보안 머리글 · 요청 번호 · 요청 로그 · 오류 처리)이어야 해서다.
// biome-ignore lint/complexity/noStaticOnlyClass: 진입점 넷이 같은 시작을 쓰게 하는 한 곳
export class CairnApp {
  /** HTTP 서버: Nest 앱 + 내려갈 때 훅 + HttpSetup + 듣기 */
  static async api(options: ApiOptions = {}): Promise<INestApplication> {
    const app = await NestFactory.create(AppModule, options.quiet ? { logger: false } : {});
    if (options.signals !== false) app.enableShutdownHooks();
    HttpSetup.apply(app, options.log);
    await app.listen(options.port ?? Number(process.env.PORT ?? 4000), options.host ?? '0.0.0.0');
    return app;
  }

  /** 운영 서버 (main.api.ts): api와, 운영에서만 하는 일 (러너 연결 값 쓰기, 설치 코드 알리기) */
  static async serve(): Promise<void> {
    const app = await CairnApp.api();
    console.log(`cairn api listening on ${await app.getUrl()}`);

    // 서버 러너 · 코드 러너 칸이 스스로 연결할 연결 값을 볼륨에 쓴다 (러너가 없는 배포면 하지 않는다)
    try {
      for (const file of await app.get(ServerRunnerGateway).publish())
        console.log(`러너 연결 값을 썼어요: ${file}`);
    } catch (error) {
      console.error(`러너 연결 값을 쓰지 못했어요: ${(error as Error).message}`);
    }

    // 아직 주인이 없으면 설치 코드를 알려준다 (pnpm install-code로도 볼 수 있음)
    const status = await app.get(SpaceQuery).installStatus(new SystemActor(), null);
    if (!status.installed)
      console.log(
        `설치 코드: ${app.get(InstallPolicy).code()}  (브라우저에서 ${process.env.CAIRN_WEB_URL ?? 'http://localhost:3000'}/install 을 열고 이 코드를 넣으세요)`,
      );
  }

  /** 일꾼 (main.worker.ts): HTTP를 열지 않고 이벤트 넘기기와 반복 · 마감 작업만 */
  static async worker(): Promise<void> {
    const app = await NestFactory.createApplicationContext(AppModule);
    app.enableShutdownHooks();
    app.get(OutboxWorker).start();
  }

  /** 명령줄 (main.cli.ts): 오류 · 경고만 로그. 부른 쪽이 끝나면 닫는다 */
  static cli(): Promise<INestApplicationContext> {
    return NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  }
}
