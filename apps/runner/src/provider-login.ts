import { pause } from './backoff';
import type { BrowserPages, BrowserTab } from './browser-page';
import { DevToolsSession } from './browser-tabs';
import { LoginFieldRef, LoginFormRef } from './login-form-ref';

/** 그 화면에서 찾은 간편 로그인 회사의 아이디 · 비밀번호 칸 (값 없음) */
export type ProviderForm = { provider: string; pageUrl: string; form: LoginFormRef };

/**
 * 페이지에서 돌리는 찾기 (AI 없음): 보이는 비밀번호 칸이 꼭 하나, 그 폼 안의 보이는 글 칸(text · email · tel)이 꼭 하나,
 * 보내기 단추가 꼭 하나일 때만 그 셋을 돌려준다. 아니면 null (여러 단계 로그인 · 휴대폰 승인 화면은 화면에서 직접)
 */
const FIND = `(() => {
  const shown = (e) => {
    const r = e.getBoundingClientRect();
    const s = getComputedStyle(e);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && !e.disabled;
  };
  const passwords = [...document.querySelectorAll('input[type=password]')].filter(shown);
  if (passwords.length !== 1) return null;
  const password = passwords[0];
  const scope = password.form || document;
  const ids = [...scope.querySelectorAll('input')].filter(
    (e) => shown(e) && ['', 'text', 'email', 'tel'].includes((e.getAttribute('type') || '').toLowerCase()),
  );
  if (ids.length !== 1) return null;
  const buttons = [...scope.querySelectorAll('button, input[type=submit]')].filter((e) => {
    const type = (e.getAttribute('type') || '').toLowerCase();
    return shown(e) && (type === 'submit' || (e.tagName === 'BUTTON' && type === ''));
  });
  if (buttons.length !== 1) return null;
  return [ids[0], password, buttons[0]];
})()`;

// 간편 로그인 뒤 (2026-11-26 사용자 결정): 사이트의 "카카오로 로그인"을 누르면 그 회사의 로그인 화면이 같은 탭이나 새 창으로 열린다.
// 그 화면이 고정 목록(LoginFormRef.PROVIDERS)의 호스트일 때만 아이디 · 비밀번호 칸을 AI 없이 찾아 로그인 카드에 띄운다:
// 어느 칸인지는 접근성 트리의 역할 + 이름으로 적어, 값을 넣을 때 LoginForm이 같은 규칙으로 다시 찾는다 (하나뿐 · 종류 · 보임).
// 찾지 못하면(여러 단계 · 휴대폰 승인 · 캡차) 카드는 그 화면을 보이고 관리자가 휴대폰이나 화면에서 마친다
// biome-ignore lint/complexity/noStaticOnlyClass: 탭을 찾고 칸을 읽는 한 곳. LoginRunner가 쓴다
export class ProviderLogin {
  /** 누른 뒤 그 회사의 화면이 뜨기를 기다리는 시간 */
  private static readonly WAIT_MS = 6_000;

  /** 그 회사의 로그인 화면이 열린 탭 (새 창이면 그 창). 기다려도 없으면 null */
  static async tab(
    pages: BrowserPages,
    provider: string,
    signal: AbortSignal,
  ): Promise<BrowserTab | null> {
    const until = Date.now() + ProviderLogin.WAIT_MS;
    while (Date.now() < until) {
      const tabs = await pages.tabs(signal);
      const found = tabs.find((t) => LoginFormRef.providerHost(provider, t.url));
      if (found) return found;
      await pause(300, signal);
    }
    return null;
  }

  /** 그 화면의 아이디 · 비밀번호 칸과 로그인 단추. 고정 목록의 호스트가 아니거나 찾지 못하면 null */
  static async form(
    tab: BrowserTab,
    provider: string,
    signal: AbortSignal,
  ): Promise<ProviderForm | null> {
    if (!LoginFormRef.providerHost(provider, tab.url)) return null;
    const form = await ProviderLogin.read(tab, signal);
    return form ? { provider, pageUrl: tab.url, form } : null;
  }

  /** 화면에서 아이디 · 비밀번호 칸과 로그인 단추를 AI 없이 찾는다 (어느 주소인지는 form이 본다). 못 찾으면 null */
  static async read(tab: BrowserTab, signal: AbortSignal): Promise<LoginFormRef | null> {
    const s = await DevToolsSession.open(tab.socket, signal);
    try {
      const found = await s.send('Runtime.evaluate', { expression: FIND, returnByValue: false });
      const list = (found.result as { objectId?: string; subtype?: string } | undefined) ?? {};
      if (!list.objectId || list.subtype !== 'array') return null;
      const props = await s.send('Runtime.getProperties', {
        objectId: list.objectId,
        ownProperties: true,
      });
      const items = ((props.result ?? []) as { name: string; value?: { objectId?: string } }[])
        .filter((p) => /^\d+$/.test(p.name))
        .sort((a, b) => Number(a.name) - Number(b.name))
        .map((p) => p.value?.objectId);
      if (items.length !== 3 || items.some((id) => !id)) return null;
      const [id, password, submit] = await Promise.all(
        (items as string[]).map((objectId) => ProviderLogin.named(s, objectId)),
      );
      if (!id || !password || !submit) return null;
      return new LoginFormRef(
        [
          new LoginFieldRef('id', id.role, id.name),
          new LoginFieldRef('password', password.role, password.name),
        ],
        submit,
      );
    } finally {
      s.close();
    }
  }

  /** 요소의 접근성 역할과 이름. 이름이 없으면 null (다시 찾을 수 없다) */
  private static async named(
    s: DevToolsSession,
    objectId: string,
  ): Promise<{ role: string; name: string } | null> {
    const described = await s.send('DOM.describeNode', { objectId });
    const backendNodeId = (described.node as { backendNodeId?: number } | undefined)?.backendNodeId;
    if (typeof backendNodeId !== 'number') return null;
    const tree = await s.send('Accessibility.getPartialAXTree', {
      backendNodeId,
      fetchRelatives: false,
    });
    const node = (
      (tree.nodes ?? []) as {
        backendDOMNodeId?: number;
        role?: { value?: unknown };
        name?: { value?: unknown };
      }[]
    ).find((n) => n.backendDOMNodeId === backendNodeId);
    const role = typeof node?.role?.value === 'string' ? node.role.value.toLowerCase() : '';
    const name = typeof node?.name?.value === 'string' ? node.name.value.trim() : '';
    return /^[a-z]{1,40}$/.test(role) && name.length > 0 && name.length <= 200
      ? { role, name }
      : null;
  }
}
