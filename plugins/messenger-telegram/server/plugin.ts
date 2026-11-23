import { BasePlugin, type PluginContext } from '../../../apps/server/src/plugin-api';
import { ConnectAction } from './connect.action';
import { Receive } from './hook';
import { CreatePairing, ListLinks, Unlink } from './links';
import { SendCard, SendSaid } from './outbound';
import { Replies } from './replies';
import { SendHandler } from './send.handler';
import { TelegramGateway } from './telegram.gateway';

// 텔레그램으로 대표와 대화하는 기능 패키지 (2026-11-23, 기획서 결정: 8단계 연동 중 텔레그램만).
//   받기: 웹훅(Receive) → 이어 둔 계정의 말만 관리자의 대화로 (코어의 대화 입구 work.sendChat, uses의 chat)
//   보내기: 대화의 답 · 실패(task.chat.said) · 결과 카드(task.approval.requested) → plugin.telegram.send → SendHandler
//   승인 · 반려는 콘솔에서만 (원칙 7). 비밀번호 같은 비밀은 이 길로 받지 않는다 (원칙 8: 대화에 남는다)
export default class MessengerTelegramPlugin extends BasePlugin {
  static readonly API_URL = 'https://api.telegram.org';

  register(cairn: PluginContext): void {
    const settings = cairn.settings();
    const token = settings.get('token') ?? '';
    const site = (settings.get('siteUrl') ?? '').trim().replace(/\/+$/, '');
    const telegram = token
      ? new TelegramGateway(token, settings.get('apiUrl') || MessengerTelegramPlugin.API_URL)
      : null;
    const replies = new Replies(site);
    cairn.addOperation(new Receive(token, replies));
    cairn.addOperation(new ListLinks(telegram !== null && site !== ''));
    cairn.addOperation(new CreatePairing());
    cairn.addOperation(new Unlink());
    cairn.onEvent('task.chat.said', new SendSaid(replies));
    cairn.onEvent('task.approval.requested', new SendCard(replies));
    cairn.onEvent('plugin.telegram.*', new SendHandler(telegram));
    cairn.addAction('connect', new ConnectAction(telegram, token, site));
  }
}
