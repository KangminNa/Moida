import { Injectable } from '@nestjs/common';
import { BaseDueJob, SystemActor } from '../../platform';
import { ExternalTool } from './external-tool';
import { ExternalToolOAuthService } from './external-tool-oauth.service';

// 끝나 가는 OAuth 커넥터 토큰을 서버가 갱신한다 (C1): 끝나기 10분 전, 잠깐 실패했으면 5분 뒤, 갱신 토큰이 없으면 끝나는 때.
// 마감 작업: 가장 이른 다시 볼 때(token_refresh_at)에 깬다. 로그인 칸의 저장(ExternalToolRepository.saveLogin)이 깨운다
@Injectable()
export class ExternalToolRefreshJob extends BaseDueJob {
  readonly name = ExternalTool.REFRESH_JOB;

  constructor(private readonly oauth: ExternalToolOAuthService) {
    super();
  }

  run(now: Date): Promise<Date | null> {
    return this.oauth.refreshDue(new SystemActor(), now);
  }
}
