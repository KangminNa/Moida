import { BasePlugin, type PluginContext } from '../../../apps/server/src/plugin-api';
import { AskTask, DropAsked, GetAsk, ListAgentRepos, StartAsked } from './asks';
import {
  ArchiveRepo,
  ConfirmMerge,
  CreateRepo,
  Credential,
  GetPull,
  ListPulls,
  ListRepos,
  PullOpened,
  RequestCode,
  UpdateRepo,
} from './operations';

// 코드 작업을 GitHub와 잇는 기능 패키지 (코드 작업 4단계, docs/코드작업.md).
// 코어는 code 작업을 칸에게 빌려 줄 뿐 어느 저장소 서비스인지 모른다: 저장소 · 토큰 · PR은 여기에만 있다.
// 외부(GitHub) 호출은 칸 러너가 한다 (push · PR). 서버의 이 패키지는 저장소 등록 · 토큰 건네기 · PR 기록 · 결재 마무리만.
export default class CodeGithubPlugin extends BasePlugin {
  static readonly API_URL = 'https://api.github.com';

  register(cairn: PluginContext): void {
    const settings = cairn.settings();
    cairn.addOperation(new ListRepos());
    cairn.addOperation(new CreateRepo());
    cairn.addOperation(new UpdateRepo());
    cairn.addOperation(new ArchiveRepo());
    cairn.addOperation(new RequestCode());
    cairn.addOperation(new ListPulls());
    cairn.addOperation(new GetPull());
    cairn.addOperation(
      new Credential(
        settings.get('token') ?? '',
        settings.get('apiUrl') || CodeGithubPlugin.API_URL,
      ),
    );
    cairn.addOperation(new PullOpened());
    cairn.onEvent('task.approval.granted', new ConfirmMerge());
    // 코드 작업 열기 (2026-11-15 C): 에이전트의 요청 → 결재 code.task.start → 승인되면 코드 작업을 연다
    cairn.addOperation(new ListAgentRepos());
    cairn.addOperation(new AskTask());
    cairn.addOperation(new GetAsk());
    cairn.onEvent('task.approval.granted', new StartAsked());
    for (const closed of ['rejected', 'revision_requested', 'cancelled'])
      cairn.onEvent(`task.approval.${closed}`, new DropAsked());
  }
}
