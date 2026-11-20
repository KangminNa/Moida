import { BasePlugin, type PluginContext } from '../../../apps/server/src/plugin-api';
import { SaveRequests } from './api-tools';
import { ApprovalDecided, TaskSettled } from './approvals';
import { BrowserJob, LoginNeeded } from './browse';
import { ClickDetail, HoldClick, ListClicks, ManualClick, NextClick, SaveClick } from './clicks';
import { SaveBuild } from './integration-build';
import {
  BuildIntegration,
  DeleteIntegration,
  EnableIntegration,
  IntegrationDetail,
  ListIntegrations,
  RebuildIntegration,
  TurnOffIntegration,
} from './integrations';
import { LoginCard, NextLogin, SaveLogin, SendLogin } from './login-card';
import { LoginInbox } from './login-inbox';
import { ListReads, PendingReads, RequestRead, SaveRead } from './reads';
import { DismissSuggestion, ListSuggestions } from './repeats';
import { ReviewMaterial, SaveReview } from './reviews';
import { NextRun, SaveRun } from './run-queue';
import { ScreenControl, ScreenRead } from './screen';
import { BrowserScreenGateway } from './screen.gateway';
import { ListShots, SaveShot, ShotDetail } from './shots';
import { SiteResult, SiteRun, SiteTools } from './site-runs';
import {
  AgentSites,
  ClearSession,
  CreateSite,
  DeleteSite,
  ListSites,
  RequestBrowse,
  RequestExplore,
  UpdateSite,
} from './sites';
import { ManualRun } from './write-runs';

// 첫 기능 패키지: 서버 브라우저를 쓰는 일 (docs/브라우저.md).
//   탭 읽기: 관리자가 고른 주소를 러너가 탭으로 열어 읽고 남긴다 (AI 없음)
//   브라우저 에이전트: 등록한 사이트(로그인된 프로필)나 둘러보기(일마다 새 빈 컨텍스트)에서 서버 러너의 AI가 일한다.
//     AI는 마지막 버튼 앞에서 멈추고, 러너(AI 없음)가 버튼 · 지문 · 화면을 붙잡아 결재를 올린다. 승인되면 러너가
//     같은 페이지 · 같은 버튼인지 다시 보고 누른다 (결재된 클릭). 로그인이 풀려 있으면 "로그인 필요" 결재로 기다린다
//   단계 화면: AI가 단계마다 찍은 화면과 러너가 찍은 화면을 작업에 남긴다
//   화면: 콘솔에서 서버 브라우저를 그림으로 보고 클릭 · 입력을 보낸다 (CDP 중계, HTTPS만). 사이트 세션 지우기
//   사이트 도구 (2026-11-16 MCP 2단계): 되풀이하는 읽기 일을 Playwright 코드로 굳히고(integrations · integration-build),
//     에이전트가 site_run으로 부르면 서버 러너가 AI 없이 돌린다 (site-runs · run-queue).
//     MCP 3단계: 고장 자동 고치기(run-queue), 되풀이되는 일 제안(repeats), 쓰기 도구의 결재(write-runs) · 검토자 짝(reviews)
// 코어를 고치지 않고 자기 표(browser_tabs) · API(/api/p/browser-tabs/…) · MCP 도구 · 콘솔 메뉴를 갖는다.
export default class BrowserTabsPlugin extends BasePlugin {
  register(cairn: PluginContext): void {
    const screen = new BrowserScreenGateway();
    // 로그인 카드의 값: 이 프로세스의 메모리에만 (DB에 남기지 않는다, 2026-11-19)
    const logins = new LoginInbox();
    // 고장 난 사이트 도구를 하루 한 번 저절로 다시 굳히는가 (설정 autoRepair, 기본 켬)
    const autoRepair = cairn.settings().get('autoRepair') !== 'false';
    // 사이트 일에서 기록한 API로 사이트 도구를 저절로 만드는가 (설정 autoApiTools, 기본 켬, 2026-11-19 B3)
    const autoApiTools = cairn.settings().get('autoApiTools') !== 'false';
    for (const operation of [
      new ListReads(),
      new RequestRead(),
      new PendingReads(),
      new SaveRead(),
      new ListSites(),
      new AgentSites(),
      new CreateSite(),
      new UpdateSite(),
      new DeleteSite(),
      new RequestBrowse(),
      new RequestExplore(),
      new ClearSession(screen),
      new BrowserJob(),
      new LoginNeeded(),
      new LoginCard(logins),
      new SendLogin(logins),
      new NextLogin(logins),
      new SaveLogin(logins),
      new HoldClick(),
      new NextClick(),
      new SaveClick(),
      new ManualClick(),
      new ListClicks(),
      new ClickDetail(),
      new SaveShot(),
      new ListShots(),
      new ShotDetail(),
      new ScreenRead(screen),
      new ScreenControl(screen),
      new ListIntegrations(),
      new IntegrationDetail(),
      new BuildIntegration(),
      new RebuildIntegration(),
      new EnableIntegration(),
      new TurnOffIntegration(),
      new DeleteIntegration(),
      new SaveBuild(),
      new SaveRequests(autoApiTools),
      new SiteTools(),
      new SiteRun(),
      new SiteResult(),
      new NextRun(),
      new SaveRun(autoRepair),
      new ListSuggestions(),
      new DismissSuggestion(),
      new ReviewMaterial(),
      new SaveReview(),
      new ManualRun(),
    ])
      cairn.addOperation(operation);
    cairn.onEvent('task.approval.granted', new ApprovalDecided('granted'));
    cairn.onEvent('task.approval.revision_requested', new ApprovalDecided('revised'));
    cairn.onEvent('task.approval.rejected', new ApprovalDecided('closed'));
    cairn.onEvent('task.approval.cancelled', new ApprovalDecided('closed'));
    cairn.onEvent('task.task.changed', new TaskSettled());
  }
}
