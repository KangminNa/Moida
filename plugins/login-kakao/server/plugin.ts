import { BasePlugin, type PluginContext } from '../../../apps/server/src/plugin-api';
import { KakaoLogin } from './kakao-login';
import { KakaoLoginGateway } from './kakao-login.gateway';

// 카카오 로그인: 커뮤니티 회원 로그인(스토어 3-1)과 관리자 로그인 화면에 "카카오로 로그인"을 더한다.
// 카카오는 돌아올 주소를 여럿 받아 앱 도메인마다 쓸 수 있다 (members). REST API 키가 비어 있으면 등록하지 않는다.
export default class LoginKakaoPlugin extends BasePlugin {
  register(cairn: PluginContext): void {
    const settings = cairn.settings();
    const restApiKey = settings.get('restApiKey') ?? '';
    if (!restApiKey) return;
    const gateway = new KakaoLoginGateway(
      restApiKey,
      settings.get('clientSecret') || null,
      (settings.get('authUrl') || 'https://kauth.kakao.com').replace(/\/+$/, ''),
      (settings.get('apiUrl') || 'https://kapi.kakao.com').replace(/\/+$/, ''),
    );
    cairn.addLogin('kakao', new KakaoLogin(gateway), { members: true });
  }
}
