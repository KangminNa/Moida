import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Claude Code의 사용자 설정 (~/.claude/settings.json). 훅을 더할 때 사용자의 훅은 지우거나 덮지 않는다.
// 우리 훅은 명령에 든 스크립트 이름으로 알아본다 (경로가 바뀌었어도). 읽을 수 없는 모양이면 건드리지 않는다.
export class ClaudeSettings {
  constructor(readonly file: string) {}

  /** 설정. 없으면 빈 것, 읽을 수 없는 모양이면 null */
  read(): Record<string, unknown> | null {
    if (!existsSync(this.file)) return {};
    try {
      const parsed = JSON.parse(readFileSync(this.file, 'utf8')) as unknown;
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }

  /** 통째로 바꿔 쓴다 (Claude Code가 반쯤 쓴 파일을 읽지 않게) */
  write(settings: Record<string, unknown>): void {
    mkdirSync(join(this.file, '..'), { recursive: true });
    const temp = `${this.file}.moida.tmp`;
    writeFileSync(temp, `${JSON.stringify(settings, null, 2)}\n`);
    renameSync(temp, this.file);
  }

  /** 그 이벤트(UserPromptSubmit · SessionEnd …)에 우리 스크립트의 훅이 있는가 */
  hasHook(settings: Record<string, unknown>, event: string, script: string): boolean {
    return this.entries(settings, event).some((h) => ClaudeSettings.ours(h.command, script));
  }

  /** 우리 훅을 그 이벤트에 하나 더한다 (경로가 바뀌었으면 고친다). 바꿨으면 true */
  addHook(
    settings: Record<string, unknown>,
    event: string,
    script: string,
    command: string,
    timeout: number,
  ): boolean {
    const mine = this.entries(settings, event).find((h) => ClaudeSettings.ours(h.command, script));
    if (mine?.command === command) return false;
    if (mine) {
      mine.command = command;
      return true;
    }
    const hooks = (settings.hooks ?? {}) as Record<string, unknown>;
    const groups = Array.isArray(hooks[event]) ? (hooks[event] as unknown[]) : [];
    hooks[event] = [...groups, { hooks: [{ type: 'command', command, timeout }] }];
    settings.hooks = hooks;
    return true;
  }

  /** 우리 스크립트를 부르는 명령인가. 옛 이름의 스크립트(cairn-news.mjs …, 2026-11-28 이름 cairn → moida 전에 건 훅)도
   *  우리 것으로 본다: 다시 연결하면 그 훅의 명령을 새 스크립트로 바꿔 둘이 함께 돌지 않게 */
  static ours(command: unknown, script: string): boolean {
    if (typeof command !== 'string') return false;
    const legacy = script.startsWith('moida-') ? `cairn-${script.slice('moida-'.length)}` : null;
    return command.includes(script) || (legacy !== null && command.includes(legacy));
  }

  private entries(settings: Record<string, unknown>, event: string): { command?: unknown }[] {
    const groups = (settings.hooks as Record<string, unknown> | undefined)?.[event];
    if (!Array.isArray(groups)) return [];
    return groups.flatMap((group) =>
      Array.isArray((group as { hooks?: unknown }).hooks)
        ? ((group as { hooks: { command?: unknown }[] }).hooks ?? [])
        : [],
    );
  }
}
