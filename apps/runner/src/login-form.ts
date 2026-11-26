import { pause } from './backoff';
import type { BrowserTab } from './browser-page';
import { DevToolsSession } from './browser-tabs';
import { LoginFormRef, type SocialLoginRef } from './login-form-ref';

/** 칸이나 로그인 단추를 찾지 못하거나 쓸 수 없는 상태 (페이지의 문제). 까닭은 카드에 그대로 보인다 (값은 없다) */
export class LoginFormProblemOnPage extends Error {}

type Inspected = {
  tag: string;
  type: string;
  visible: boolean;
  enabled: boolean;
  onTop: boolean;
  center: { x: number; y: number };
};

/** 요소에서 돌리는 확인: 보이는 자리로 옮기고 종류 · 보이는지 · 쓸 수 있는지 · 가장 위인지 */
const INSPECT = `function () {
  this.scrollIntoView({ block: 'center', inline: 'center' });
  const r = this.getBoundingClientRect();
  const x = r.left + r.width / 2;
  const y = r.top + r.height / 2;
  const top = document.elementFromPoint(x, y);
  const style = getComputedStyle(this);
  return {
    tag: this.tagName.toLowerCase(),
    type: (this.getAttribute('type') || '').toLowerCase(),
    visible: r.width > 0 && r.height > 0 && style.visibility !== 'hidden' && style.display !== 'none',
    enabled: !this.disabled && !this.readOnly && this.getAttribute('aria-disabled') !== 'true',
    onTop: top === this || this.contains(top) || (top !== null && top.control === this),
    center: { x, y },
  };
}`;
/** 칸에 넣기 전: 앞의 값을 고른다 (넣는 글이 바꿔 쓴다) */
const FOCUS = `function () { this.focus(); if (typeof this.select === 'function') this.select(); }`;
/** 넣은 뒤: 들어간 글의 길이 (값은 돌려받지 않는다) */
const LENGTH = 'function () { return String(this.value || "").length; }';

// 로그인 카드의 값을 넣는 쪽 (2026-11-19, AI 없음). AI가 알려 준 칸(역할 + 이름)을 접근성 트리에서 다시 찾아
// 하나뿐이고 · 보이고 · 쓸 수 있고 · 종류가 맞을 때만(비밀번호는 type=password) 넣고, 로그인 단추를 실제 마우스 이벤트로 누른다.
// 값은 CDP의 Input.insertText로만 보낸다: 페이지 스크립트(Runtime)에 글로 싣지 않고, 로그 · 화면 · 서버로 돌려보내지 않는다.
// 사이트의 로그인 요청을 재현하지 않고 그 화면의 칸에 넣는 까닭: CSRF 토큰 · 스크립트 암호화 · 리다이렉트를 사이트가 그대로 한다
// biome-ignore lint/complexity/noStaticOnlyClass: 탭 하나에 붙어 칸을 찾고 넣는 한 곳. BrowseLogin · LoginRunner가 쓴다
export class LoginForm {
  /** 누른 뒤 주소가 바뀌기를 기다리는 시간 */
  private static readonly AFTER_MS = 10_000;
  /** 주소가 그대로여도(한 화면 로그인) 그려지기를 기다리는 시간 */
  private static readonly SETTLE_MS = 2_000;

  /**
   * 탭에서 칸 · 단추를 다시 찾아 쓸 수 있는지 본다. 칸이나 로그인 단추를 쓸 수 없으면 LoginFormProblemOnPage.
   * 간편 로그인 단추는 누를 수 있는 것만 남긴다 (하나도 없고 칸도 없으면 LoginFormProblemOnPage). 확인한 모양을 돌려준다
   */
  static async check(
    tab: BrowserTab,
    form: LoginFormRef,
    signal: AbortSignal,
  ): Promise<LoginFormRef> {
    const s = await DevToolsSession.open(tab.socket, signal);
    try {
      for (const field of form.fields) await LoginForm.field(s, field.kind, field.role, field.name);
      if (form.submit) await LoginForm.button(s, form.submit.role, form.submit.name);
      const social: SocialLoginRef[] = [];
      for (const button of form.social) {
        const pressable = await LoginForm.button(s, button.role, button.name).then(
          () => true,
          (error: unknown) => {
            if (error instanceof LoginFormProblemOnPage) return false;
            throw error;
          },
        );
        if (pressable) social.push(button);
      }
      if (form.fields.length === 0 && social.length === 0)
        throw new LoginFormProblemOnPage('간편 로그인 단추를 찾지 못했어요');
      return new LoginFormRef(form.fields, form.submit, social);
    } finally {
      s.close();
    }
  }

  /**
   * 간편 로그인 단추를 실제 마우스 이벤트로 누르고 주소가 바뀌거나 그려질 때까지 기다린다 (2026-11-26, AI 없음).
   * 탭의 출처가 origin이 아니면 누르지 않는다. 누른 뒤의 주소를 돌려준다 (새 창으로 열리면 그대로일 수 있다)
   */
  static async press(
    tab: BrowserTab,
    origin: string,
    button: SocialLoginRef,
    signal: AbortSignal,
  ): Promise<string> {
    const s = await DevToolsSession.open(tab.socket, signal);
    try {
      await s.send('Page.bringToFront');
      const before = await LoginForm.location(s);
      if (!URL.canParse(before) || new URL(before).origin !== origin)
        throw new LoginFormProblemOnPage('로그인 화면이 아닌 곳이라 누르지 않았어요');
      await LoginForm.click(s, await LoginForm.button(s, button.role, button.name));
      return await LoginForm.settle(s, before, signal);
    } finally {
      s.close();
    }
  }

  /**
   * 칸마다 값을 넣고 로그인 단추를 누른 뒤 주소가 바뀌거나 그려질 때까지 기다린다. 누른 뒤의 주소를 돌려준다.
   * 탭의 출처가 origin이 아니면 넣지 않는다 (값이 다른 곳으로 가지 않게)
   */
  static async submit(
    tab: BrowserTab,
    origin: string,
    form: LoginFormRef,
    values: ReadonlyMap<string, string>,
    signal: AbortSignal,
  ): Promise<string> {
    const s = await DevToolsSession.open(tab.socket, signal);
    try {
      await s.send('Page.bringToFront');
      const before = await LoginForm.location(s);
      if (!URL.canParse(before) || new URL(before).origin !== origin)
        throw new LoginFormProblemOnPage('로그인 화면이 아닌 곳이라 넣지 않았어요');
      for (const field of form.fields) {
        const value = values.get(field.kind) ?? '';
        if (!value) throw new LoginFormProblemOnPage(`넣을 값이 비었어요 (${field.kind})`);
        const objectId = await LoginForm.field(s, field.kind, field.role, field.name);
        await s.send('Runtime.callFunctionOn', { objectId, functionDeclaration: FOCUS });
        await s.send('Input.insertText', { text: value });
        const got = await s.send('Runtime.callFunctionOn', {
          objectId,
          functionDeclaration: LENGTH,
          returnByValue: true,
        });
        if ((got.result as { value?: unknown } | undefined)?.value !== value.length)
          throw new LoginFormProblemOnPage(`칸에 값이 다 들어가지 않았어요 (${field.kind})`);
      }
      if (!form.submit) throw new LoginFormProblemOnPage('로그인 단추가 없어요');
      await LoginForm.click(s, await LoginForm.button(s, form.submit.role, form.submit.name));
      return await LoginForm.settle(s, before, signal);
    } finally {
      s.close();
    }
  }

  /** 그 자리를 실제 마우스 이벤트로 한 번 누른다 */
  private static async click(s: DevToolsSession, at: { x: number; y: number }): Promise<void> {
    await s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...at });
    const press = { ...at, button: 'left', clickCount: 1 };
    await s.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...press });
    await s.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...press });
  }

  /** 넣어도 되는 출처인가: https, 또는 이 컴퓨터(테스트 · 직접 띄운 사이트)의 http */
  static safeOrigin(url: string): boolean {
    if (!URL.canParse(url)) return false;
    const u = new URL(url);
    if (u.protocol === 'https:') return true;
    return u.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname);
  }

  /** 칸 하나: 하나뿐이고 보이고 쓸 수 있는 input · textarea, 비밀번호는 type=password만 · 다른 칸은 아님 */
  private static async field(
    s: DevToolsSession,
    kind: string,
    role: string,
    name: string,
  ): Promise<string> {
    const { objectId, found } = await LoginForm.only(s, role, name, `칸 "${name}"`);
    if (found.tag !== 'input' && found.tag !== 'textarea')
      throw new LoginFormProblemOnPage(`칸 "${name}"이 입력 칸이 아니에요`);
    if ((kind === 'password') !== (found.type === 'password'))
      throw new LoginFormProblemOnPage(`칸 "${name}"의 종류가 맞지 않아요`);
    if (found.type === 'hidden' || !found.visible || !found.enabled)
      throw new LoginFormProblemOnPage(`칸 "${name}"이 보이지 않거나 쓸 수 없어요`);
    return objectId;
  }

  /** 로그인 단추: 하나뿐이고 보이고 켜져 있고 가려지지 않은 것. 누를 자리를 돌려준다 */
  private static async button(
    s: DevToolsSession,
    role: string,
    name: string,
  ): Promise<{ x: number; y: number }> {
    const { found } = await LoginForm.only(s, role, name, `단추 "${name}"`);
    if (!found.visible || !found.enabled || !found.onTop)
      throw new LoginFormProblemOnPage(`단추 "${name}"을 누를 수 없어요`);
    return found.center;
  }

  /** 접근성 트리에서 역할 + 이름이 같은 노드가 꼭 하나일 때 그 요소와 확인 결과 */
  private static async only(
    s: DevToolsSession,
    role: string,
    name: string,
    label: string,
  ): Promise<{ objectId: string; found: Inspected }> {
    const doc = (await s.send('DOM.getDocument', { depth: 0 })).root as { nodeId: number };
    const tree = await s.send('Accessibility.queryAXTree', {
      nodeId: doc.nodeId,
      accessibleName: name,
      role,
    });
    const nodes = ((tree.nodes ?? []) as { ignored?: boolean; backendDOMNodeId?: number }[]).filter(
      (n) => !n.ignored && typeof n.backendDOMNodeId === 'number',
    );
    if (nodes.length !== 1)
      throw new LoginFormProblemOnPage(
        nodes.length === 0 ? `${label}을 찾지 못했어요` : `${label}이 여럿이에요`,
      );
    const resolved = await s.send('DOM.resolveNode', { backendNodeId: nodes[0]?.backendDOMNodeId });
    const objectId = (resolved.object as { objectId?: string } | undefined)?.objectId;
    if (!objectId) throw new LoginFormProblemOnPage(`${label}을 찾지 못했어요`);
    const inspected = await s.send('Runtime.callFunctionOn', {
      objectId,
      functionDeclaration: INSPECT,
      returnByValue: true,
    });
    const found = (inspected.result as { value?: Inspected } | undefined)?.value;
    if (!found) throw new LoginFormProblemOnPage(`${label}을 확인하지 못했어요`);
    return { objectId, found };
  }

  /** 누른 뒤: 주소가 바뀌면 다 그려질 때까지, 아니면 잠깐 기다린다 */
  private static async settle(s: DevToolsSession, before: string, signal: AbortSignal) {
    const until = Date.now() + LoginForm.AFTER_MS;
    const quiet = Date.now() + LoginForm.SETTLE_MS;
    let now = before;
    while (Date.now() < until) {
      await pause(250, signal);
      now = await LoginForm.location(s).catch(() => now);
      if (now !== before) break;
      if (Date.now() >= quiet) return now;
    }
    for (let i = 0; i < 20; i++) {
      const read = await s
        .send('Runtime.evaluate', { expression: 'document.readyState', returnByValue: true })
        .catch(() => null);
      if ((read?.result as { value?: unknown } | undefined)?.value === 'complete') break;
      await pause(250, signal);
    }
    return now;
  }

  private static async location(s: DevToolsSession): Promise<string> {
    const read = await s.send('Runtime.evaluate', {
      expression: 'location.href',
      returnByValue: true,
    });
    return String((read.result as { value?: unknown } | undefined)?.value ?? '');
  }
}
