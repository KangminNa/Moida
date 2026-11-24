import { Injectable } from '@nestjs/common';
import { Actor, BaseTool } from '../../platform';
import { ApiCallService } from './api-call.service';
import { ApiCallInput, ApiRunInput, ProposeApiInput } from './api-connector.input';
import { ApiConnectorQuery } from './api-connector.query';
import { ApiConnectorService } from './api-connector.service';
import type { ApiCallView, ApiToolListView, ProposedApiView } from './api-connector.view';

// API 커넥터의 MCP 도구 (2026-11-24, 작업 토큰). 설명은 task.tools.ko.json.
//   propose_api: 서비스의 API 문서로 쓴 정의서를 낸다 (결재 task.api.plug, 서버가 올린다)
//   api_tools: 켜진 커넥터와 동작 · 입력 칸 / api_run: 동작 하나 부르기 / api_call: 부르기 하나의 지금 상태 (기다리기)

@Injectable()
export class ProposeApiTool extends BaseTool {
  readonly name = 'propose_api';
  readonly scope = Actor.AGENT;
  readonly readOnly = false;
  readonly inputSchema = {
    properties: {
      request_id: { type: 'string', format: 'uuid' },
      name: { type: 'string', pattern: '^[a-z][a-z0-9-]{1,29}$' },
      title: { type: 'string', maxLength: 60 },
      note: { type: 'string', maxLength: 1000 },
      source: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['registry', 'docs', 'openapi', 'manual'] },
          url: { type: 'string', maxLength: 500 },
        },
        required: ['kind'],
      },
      spec: { type: 'object' },
    },
    required: ['request_id', 'name', 'title', 'source', 'spec'],
  };

  constructor(private readonly connectors: ApiConnectorService) {
    super();
  }

  handle(actor: Actor, raw: unknown): Promise<ProposedApiView> {
    return this.connectors.propose(actor, ProposeApiInput.from(raw));
  }
}

@Injectable()
export class ApiToolsTool extends BaseTool {
  readonly name = 'api_tools';
  readonly scope = Actor.AGENT;
  readonly readOnly = true;
  readonly inputSchema = { properties: {} };

  constructor(private readonly query: ApiConnectorQuery) {
    super();
  }

  handle(actor: Actor): Promise<ApiToolListView> {
    return this.query.tools(actor);
  }
}

@Injectable()
export class ApiRunTool extends BaseTool {
  readonly name = 'api_run';
  readonly scope = Actor.AGENT;
  readonly readOnly = false;
  readonly inputSchema = {
    properties: {
      request_id: { type: 'string', format: 'uuid' },
      connector: { type: 'string', maxLength: 30 },
      operation: { type: 'string', maxLength: 40 },
      input: { type: 'object' },
    },
    required: ['request_id', 'connector', 'operation'],
  };

  constructor(private readonly calls: ApiCallService) {
    super();
  }

  async handle(actor: Actor, raw: unknown): Promise<ApiCallView> {
    return (await this.calls.run(actor, ApiRunInput.from(raw))).view();
  }
}

@Injectable()
export class ApiCallTool extends BaseTool {
  readonly name = 'api_call';
  readonly scope = Actor.AGENT;
  readonly readOnly = true;
  readonly inputSchema = {
    properties: {
      call_id: { type: 'string', format: 'uuid' },
      wait_seconds: { type: 'integer', minimum: 0, maximum: ApiCallInput.WAIT_MAX },
    },
    required: ['call_id'],
  };

  constructor(private readonly query: ApiConnectorQuery) {
    super();
  }

  handle(actor: Actor, raw: unknown): Promise<ApiCallView> {
    return this.query.call(actor, ApiCallInput.from(raw));
  }
}
