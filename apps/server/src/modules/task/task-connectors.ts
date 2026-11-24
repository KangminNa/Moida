import { Injectable, type OnModuleInit } from '@nestjs/common';
import { CoreWorkers, SecretRotation } from '../platform';
import { ApiCallGateway } from './api-connector/api-call.gateway';
import { ApiCallJob } from './api-connector/api-call.job';
import { ApiCallService } from './api-connector/api-call.service';
import { ApiConnectorQuery } from './api-connector/api-connector.query';
import { ApiConnectorService } from './api-connector/api-connector.service';
import { ApiDecisionHandler } from './api-connector/api-decision.handler';
import { ToolFinderQuery } from './tool-finder/tool-finder.query';
import { ToolRegistryGateway } from './tool-finder/tool-registry.gateway';

// API 커넥터를 일꾼 · 서버 키 바꾸기에 잇는다 (2026-11-24, task.module이 길어지지 않게 TaskSettings처럼 따로).
//   결재가 정해지면 커넥터를 켜거나 한 번 부르고(ApiDecisionHandler), 상태 묻기 · 파일 받기는 마감 작업(ApiCallJob),
//   서버 키를 바꾸면 키를 다시 잠근다
@Injectable()
export class TaskConnectors implements OnModuleInit {
  /** 모듈의 providers에 펼치는 것 (API 커넥터 · 도구 찾기) */
  static readonly PROVIDERS = [
    TaskConnectors,
    ApiConnectorQuery,
    ApiConnectorService,
    ApiCallService,
    ApiCallGateway,
    ApiCallJob,
    ApiDecisionHandler,
    ToolRegistryGateway,
    ToolFinderQuery,
  ] as const;

  constructor(
    private readonly workers: CoreWorkers,
    private readonly rotation: SecretRotation,
    private readonly decisions: ApiDecisionHandler,
    private readonly calls: ApiCallJob,
    private readonly connectors: ApiConnectorService,
  ) {}

  onModuleInit(): void {
    for (const topic of ApiDecisionHandler.TOPICS) this.workers.on(topic, this.decisions);
    this.workers.due(this.calls);
    this.rotation.register('task.api_connectors', (actor) => this.connectors.resealSecrets(actor));
  }
}
