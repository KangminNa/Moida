import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { type Actor, CurrentActor, VersionInput } from '../../platform';
import {
  CreateIssueInput,
  IssueNumberInput,
  IssuePostsInput,
  ListIssuesInput,
  UpdateIssueInput,
} from './issue.input';
import { IssueQuery } from './issue.query';
import { IssueService } from './issue.service';
import type {
  IssueDetailView,
  IssueListView,
  IssueView,
  PublicIssueListView,
  PublicIssueView,
} from './issue.view';

// 매거진 호 API (2차 6단계). 발행한 호의 목록 · 하나는 누구나, 쓰기는 관리자만.
// 결재한 발행은 API가 아니라 결재 이벤트로 온다 (IssuePublishHandler).
@Controller('api/issues')
export class IssueController {
  constructor(
    private readonly query: IssueQuery,
    private readonly service: IssueService,
  ) {}

  @Get()
  list(
    @CurrentActor() actor: Actor,
    @Query() query: unknown,
  ): Promise<IssueListView | PublicIssueListView> {
    return this.query.list(actor, ListIssuesInput.from(query));
  }

  @Get('by-number/:menu/:number')
  byNumber(
    @CurrentActor() actor: Actor,
    @Param('menu') menu: string,
    @Param('number') number: string,
  ): Promise<PublicIssueView> {
    return this.query.byNumber(actor, IssueNumberInput.from(menu, number));
  }

  @Get(':id')
  detail(@CurrentActor() actor: Actor, @Param('id') id: string): Promise<IssueDetailView> {
    return this.query.detail(actor, id);
  }

  @Post()
  async create(@CurrentActor() actor: Actor, @Body() body: unknown): Promise<IssueView> {
    return (await this.service.create(actor, CreateIssueInput.from(body))).view();
  }

  @Patch(':id')
  async update(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<IssueView> {
    return (await this.service.update(actor, UpdateIssueInput.from(id, body))).view();
  }

  /** 든 글을 이 순서로 { version, postIds } */
  @HttpCode(200)
  @Post(':id/posts')
  async posts(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<IssueView> {
    return (await this.service.setPosts(actor, IssuePostsInput.from(id, body))).view();
  }

  /** 관리자의 발행 { version }: 호와 그 글을 모두 공개 */
  @HttpCode(200)
  @Post(':id/publish')
  async publish(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<IssueView> {
    return (await this.service.publish(actor, VersionInput.from(id, body))).view();
  }

  @HttpCode(204)
  @Post(':id/delete')
  async remove(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<void> {
    await this.service.remove(actor, VersionInput.from(id, body));
  }
}
