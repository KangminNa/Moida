import { Body, Controller, Delete, HttpCode, Param, Post, Req, UseGuards } from '@nestjs/common';
import { type Actor, CurrentActor, type HttpRequest, VersionInput } from '../../platform';
import { MemberGuard } from '../guard/member.guard';
import { MemberPlace } from '../member/member.input';
import { CommentWriteInput } from './comment.input';
import { CommentService } from './comment.service';
import type { CommentSavedView } from './comment.view';

// 커뮤니티 댓글 (스토어 3-1b). 앱 도메인에서만, 회원 · 쓴 회원만. 댓글 읽기는 글 하나(GET topics/:id)에 함께 온다.
//   POST   api/community/topics/:id/comments   댓글 달기 { requestId, body }
//   DELETE api/community/comments/:id          지우기 { version }
@Controller('api/community')
@UseGuards(MemberGuard)
export class CommentController {
  constructor(private readonly comments: CommentService) {}

  @Post('topics/:id/comments')
  @HttpCode(201)
  async write(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: HttpRequest,
  ): Promise<CommentSavedView> {
    const comment = await this.comments.write(
      actor,
      MemberPlace.from(req),
      CommentWriteInput.from(id, body),
    );
    return comment.savedView();
  }

  @Delete('comments/:id')
  @HttpCode(204)
  async remove(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: HttpRequest,
  ): Promise<void> {
    await this.comments.delete(actor, MemberPlace.from(req), VersionInput.from(id, body));
  }
}
