import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { type Actor, CurrentActor, type HttpRequest, VersionInput } from '../../platform';
import { MemberGuard } from '../guard/member.guard';
import { MemberPlace } from '../member/member.input';
import { TopicEditInput, TopicIdInput, TopicListInput, TopicWriteInput } from './topic.input';
import { TopicQuery } from './topic.query';
import { TopicService } from './topic.service';
import type { TopicListView, TopicSavedView, TopicView } from './topic.view';

// 커뮤니티 글 (스토어 3-1b). 앱 도메인에서만 (기본 도메인은 404). 읽기는 누구나, 쓰기는 회원 · 쓴 회원만.
//   GET    api/community/topics?cursor=   보이는 글 목록 (최근부터 30개)
//   GET    api/community/topics/:id       글 하나 + 보이는 댓글
//   POST   api/community/topics           새 글 { requestId, title, body }
//   PATCH  api/community/topics/:id       고치기 { version, title, body }
//   DELETE api/community/topics/:id       지우기 { version }
@Controller('api/community/topics')
@UseGuards(MemberGuard)
export class TopicController {
  constructor(
    private readonly query: TopicQuery,
    private readonly topics: TopicService,
  ) {}

  @Get()
  list(@CurrentActor() actor: Actor, @Req() req: HttpRequest): Promise<TopicListView> {
    return this.query.list(actor, MemberPlace.from(req), TopicListInput.from(req.query));
  }

  @Get(':id')
  one(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Req() req: HttpRequest,
  ): Promise<TopicView> {
    return this.query.one(actor, MemberPlace.from(req), TopicIdInput.from(id));
  }

  @Post()
  @HttpCode(201)
  async write(
    @CurrentActor() actor: Actor,
    @Body() body: unknown,
    @Req() req: HttpRequest,
  ): Promise<TopicSavedView> {
    const topic = await this.topics.write(actor, MemberPlace.from(req), TopicWriteInput.from(body));
    return topic.savedView();
  }

  @Patch(':id')
  async edit(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: HttpRequest,
  ): Promise<TopicSavedView> {
    const topic = await this.topics.edit(
      actor,
      MemberPlace.from(req),
      TopicEditInput.from(id, body),
    );
    return topic.savedView();
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: HttpRequest,
  ): Promise<void> {
    await this.topics.delete(actor, MemberPlace.from(req), VersionInput.from(id, body));
  }
}
