import { Injectable } from '@nestjs/common';
import { Actor, BaseTool } from '../../platform';
import { ToolMenusInput } from './menu.input';
import { MenuQuery } from './menu.query';
import type { ToolMenuView } from './menu.view';

// AI가 글을 쓰기 전에 앱 · 메뉴와 편집 방침을 읽는다 (2차 6단계, 앱 · 운영 팀은 스토어 2단계). blog_save_draft의 menu_id · app_id로 고른다.
// 설명 · 칸 설명은 blog.tools.ko.json에. 입력 모양을 바꾸면 쓰는 스킬(moida-write)도 함께 고친다.
@Injectable()
export class BlogMenusTool extends BaseTool {
  readonly name = 'blog_menus';
  readonly scope = Actor.WRITE;
  readonly readOnly = true;
  readonly inputSchema = {
    properties: {
      app_id: { type: 'string', format: 'uuid' },
    },
  };

  constructor(private readonly query: MenuQuery) {
    super();
  }

  handle(actor: Actor, raw: unknown): Promise<ToolMenuView> {
    return this.query.forTool(actor, ToolMenusInput.from(raw));
  }
}
