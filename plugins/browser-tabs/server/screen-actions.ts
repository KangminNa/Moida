// 서버 브라우저 화면에 보내는 동작 (2026-11-14, 2026-11-28 브라우저처럼: 끌기 · 마우스 올리기 · 더블클릭 · 조합 키 · 탭 열고 닫기).
// 탭에 붙은 CDP 연결(send) 하나로 보낸다. 화면 흘려보내기(ScreenCastGateway)와 한 번 붙는 길(BrowserScreenGateway)이 함께 쓴다.
// 탭 열고 닫기는 탭 밖의 일이라 여기가 아니라 BrowserScreenGateway.openTab · closeTab이다.

/** 화면에 보내는 동작. 좌표는 그림 위의 CSS 픽셀, mods는 조합 키 (Alt 1 · Ctrl 2 · Meta 4 · Shift 8, CDP와 같다) */
export type ScreenAction =
  | { type: 'click'; x: number; y: number; count: number }
  | { type: 'press' | 'move' | 'release'; x: number; y: number }
  | { type: 'hover'; x: number; y: number }
  | { type: 'scroll'; x: number; y: number; dy: number }
  | { type: 'text'; text: string }
  | { type: 'key'; key: string; mods: number }
  | { type: 'navigate'; url: string }
  | { type: 'back' | 'forward' | 'reload' | 'activate' }
  | { type: 'newTab'; url: string | null }
  | { type: 'closeTab' };

export type Send = (method: string, params?: object) => Promise<Record<string, unknown>>;

/** 보낼 수 있는 키 (키 이름 → Windows 키 코드 · 함께 들어가는 글자). 글자 키(a · c · v · x · z)는 Ctrl · Meta와 함께만 */
const KEYS: Record<string, { code: number; text?: string; letter?: true }> = {
  Enter: { code: 13, text: '\r' },
  Tab: { code: 9 },
  Backspace: { code: 8 },
  Delete: { code: 46 },
  Escape: { code: 27 },
  Home: { code: 36 },
  End: { code: 35 },
  PageUp: { code: 33 },
  PageDown: { code: 34 },
  ArrowUp: { code: 38 },
  ArrowDown: { code: 40 },
  ArrowLeft: { code: 37 },
  ArrowRight: { code: 39 },
  a: { code: 65, letter: true },
  c: { code: 67, letter: true },
  v: { code: 86, letter: true },
  x: { code: 88, letter: true },
  z: { code: 90, letter: true },
};

export class ScreenActions {
  /** 보낼 수 있는 키 이름 (입력 검사가 쓴다) */
  static readonly KEY_NAMES: readonly string[] = Object.keys(KEYS);
  /** Ctrl · Meta 조합 (글자 키는 이것과 함께만: 그냥 글자는 text로 간다) */
  static readonly COMMAND = 2 | 4;

  /** 글자 키를 조합 없이 보냈는가 (입력 검사가 막는다) */
  static bareLetter(key: string, mods: number): boolean {
    return KEYS[key]?.letter === true && (mods & ScreenActions.COMMAND) === 0;
  }

  /** 붙어 있는 탭에 동작 하나를 보낸다. 탭 열고 닫기는 여기서 하지 않는다 */
  static async act(send: Send, action: ScreenAction): Promise<void> {
    const mouse = (type: string, at: { x: number; y: number }, extra: object = {}) =>
      send('Input.dispatchMouseEvent', { type, x: at.x, y: at.y, ...extra });
    switch (action.type) {
      case 'click': {
        await mouse('mouseMoved', action);
        // 더블클릭은 1 · 2를 이어 보낸다 (페이지는 click 두 번과 dblclick을 받는다)
        for (let n = 1; n <= action.count; n++) {
          const press = { button: 'left', clickCount: n };
          await mouse('mousePressed', action, press);
          await mouse('mouseReleased', action, press);
        }
        return;
      }
      // 끌기: 누름 → 움직임(누른 채) → 뗌. 슬라이더 · 지도 · 글자 고르기
      case 'press':
        await mouse('mouseMoved', action);
        await mouse('mousePressed', action, { button: 'left', buttons: 1, clickCount: 1 });
        return;
      case 'move':
        await mouse('mouseMoved', action, { button: 'left', buttons: 1 });
        return;
      case 'release':
        await mouse('mouseReleased', action, { button: 'left', buttons: 0, clickCount: 1 });
        return;
      // 마우스 올리기: 올리면 열리는 메뉴 · 말풍선
      case 'hover':
        await mouse('mouseMoved', action);
        return;
      case 'scroll':
        await mouse('mouseWheel', action, { deltaX: 0, deltaY: action.dy });
        return;
      case 'text':
        await send('Input.insertText', { text: action.text });
        return;
      case 'key':
        return ScreenActions.key(send, action.key, action.mods);
      case 'navigate':
        await send('Page.navigate', { url: action.url });
        return;
      case 'back':
      case 'forward': {
        const history = await send('Page.getNavigationHistory');
        const index = Number(history.currentIndex) + (action.type === 'back' ? -1 : 1);
        const entry = (history.entries as { id: number }[])[index];
        if (entry) await send('Page.navigateToHistoryEntry', { entryId: entry.id });
        return;
      }
      // 새로고침 (2026-11-28): 캡차 · 만료된 양식처럼 페이지를 다시 받아야 풀리는 것
      case 'reload':
        await send('Page.reload', { ignoreCache: false });
        return;
      case 'activate':
        await send('Page.bringToFront');
        return;
      case 'newTab':
      case 'closeTab':
        throw new Error('탭 열고 닫기는 탭 밖의 일이에요');
    }
  }

  private static async key(send: Send, name: string, mods: number): Promise<void> {
    const key = KEYS[name];
    if (!key) throw new Error(`보낼 수 없는 키예요: ${name}`);
    const letter = key.letter === true;
    const base = {
      key: name,
      code: letter ? `Key${name.toUpperCase()}` : name,
      windowsVirtualKeyCode: key.code,
      nativeVirtualKeyCode: key.code,
      modifiers: mods,
    };
    // 조합 키(Ctrl+A 같은 것)는 글자 없이 · 편집 명령으로 (selectAll · copy · paste · cut · undo)
    const commands = letter ? ScreenActions.commandOf(name) : [];
    const text = !letter && key.text && (mods & ScreenActions.COMMAND) === 0 ? key.text : null;
    await send('Input.dispatchKeyEvent', {
      type: text ? 'keyDown' : 'rawKeyDown',
      ...base,
      ...(text ? { text } : {}),
      ...(commands.length > 0 ? { commands } : {}),
    });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
  }

  /** 글자 키의 편집 명령 (CDP Input.dispatchKeyEvent의 commands) */
  private static commandOf(letter: string): string[] {
    const named: Record<string, string> = {
      a: 'selectAll',
      c: 'copy',
      v: 'paste',
      x: 'cut',
      z: 'undo',
    };
    const command = named[letter];
    return command ? [command] : [];
  }
}
