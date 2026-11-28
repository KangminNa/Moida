import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { type Actor, CurrentActor } from '../../platform';
import { ChangeService } from '../change/change.service';
import type { ChangeSet } from '../change/change-set';
import type { Session } from './session';
import {
  ListSessionsInput,
  ReadSessionInput,
  RestoreSessionInput,
  TrashSessionInput,
} from './session.input';
import { SessionQuery } from './session.query';
import type {
  SessionDetailView,
  SessionPageView,
  SessionRevisionView,
  TranscriptView,
} from './session.view';
import type { SessionTrashedView, SessionTrashView } from './session-trash.view';
import { WorkSessionQuery } from './work-session.query';
import type { WorkSessionView } from './work-session.view';

// 관리 화면의 세션 시트가 부르는 API. 저장은 MCP 도구(save_session · save_transcript · save_note)로만 들어온다.
// 휴지통(2026-11-19 휴지통 A, 관리자만): 넣기 · 꺼내기는 변경 묶음(ChangeService.edit)으로 남아 되돌릴 수 있다.
//   GET  api/sessions/trash             휴지통의 세션
//   POST api/sessions/:id/trash         { version } 휴지통으로
//   POST api/sessions/:id/restore       { version } 되살리기
// 작업 세션 (S2, 관리자만): GET api/sessions/:id/work  요청 · 정리할 판 · 인수인계 메모
@Controller('api/sessions')
export class SessionController {
  constructor(
    private readonly sessions: SessionQuery,
    private readonly changes: ChangeService,
    private readonly works: WorkSessionQuery,
  ) {}

  /** 최근에 저장한 순서. ?project=로 거르고, 응답의 next를 ?cursor=로 보내면 다음 쪽 */
  @Get()
  list(@CurrentActor() actor: Actor, @Query() query: unknown): Promise<SessionPageView> {
    return this.sessions.list(actor, ListSessionsInput.from(query));
  }

  @Get('trash')
  trash(@CurrentActor() actor: Actor): Promise<SessionTrashView> {
    return this.sessions.trash(actor);
  }

  @Get(':id')
  get(@CurrentActor() actor: Actor, @Param() params: unknown): Promise<SessionDetailView> {
    return this.sessions.get(actor, ReadSessionInput.from(params));
  }

  @Get(':id/work')
  work(@CurrentActor() actor: Actor, @Param() params: unknown): Promise<WorkSessionView> {
    return this.works.get(actor, ReadSessionInput.from(params));
  }

  @Get(':id/revisions/:seq')
  revision(@CurrentActor() actor: Actor, @Param() params: unknown): Promise<SessionRevisionView> {
    return this.sessions.revisionOf(actor, ReadSessionInput.from(params));
  }

  /** 원문 하나 (수집 훅 · 확장이 올린 대화 글, 2차 4단계) */
  @Get(':id/transcripts/:seq')
  transcript(@CurrentActor() actor: Actor, @Param() params: unknown): Promise<TranscriptView> {
    return this.sessions.transcriptOf(actor, ReadSessionInput.from(params));
  }

  @Post(':id/trash')
  @HttpCode(200)
  async trashOne(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<SessionTrashedView> {
    return SessionController.moved(
      await this.changes.edit(actor, TrashSessionInput.from(id, body)),
    );
  }

  @Post(':id/restore')
  @HttpCode(200)
  async restore(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<SessionTrashedView> {
    return SessionController.moved(
      await this.changes.edit(actor, RestoreSessionInput.from(id, body)),
    );
  }

  private static moved(set: ChangeSet): SessionTrashedView {
    return (set.result as Session).trashedView(set.id);
  }
}
