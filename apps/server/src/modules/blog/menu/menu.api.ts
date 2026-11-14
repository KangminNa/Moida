import { Body, Controller, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { type Actor, CurrentActor, VersionInput } from '../../platform';
import { CreateMenuInput, UpdateMenuInput } from './menu.input';
import { MenuQuery } from './menu.query';
import { MenuService } from './menu.service';
import type { MenuListView, MenuView, PublicMenuListView } from './menu.view';

// 블로그 메뉴 API (2차 6단계). 목록은 누구나(관리자는 설정까지), 만들기 · 고치기 · 지우기는 관리자만.
@Controller('api/menus')
export class MenuController {
  constructor(
    private readonly query: MenuQuery,
    private readonly service: MenuService,
  ) {}

  @Get()
  list(@CurrentActor() actor: Actor): Promise<MenuListView | PublicMenuListView> {
    return this.query.list(actor);
  }

  @Post()
  async create(@CurrentActor() actor: Actor, @Body() body: unknown): Promise<MenuView> {
    return (await this.service.create(actor, CreateMenuInput.from(body))).view();
  }

  @Patch(':id')
  async update(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<MenuView> {
    return (await this.service.update(actor, UpdateMenuInput.from(id, body))).view();
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
