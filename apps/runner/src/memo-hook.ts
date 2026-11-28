import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// Claude Code의 Stop 훅 (인수인계 메모, 기획서 결정 2026-11-17): AI가 끝내려 할 때 메모 파일이 비어 있으면 한 번 막고
// 쓰게 한다. 이미 한 번 막아 다시 끝내려는 것이면(stop_hook_active) 그대로 끝낸다: 그래도 비면 러너가 AI 없이 대신 만든다.
// 훅은 CLI가 띄우는 별도 프로세스라 메모 경로와 막는 까닭(지시문 틀 memo-stop)은 환경 변수로 받는다.
// 러너가 끄는 실행(승인 · 위임으로 기다림, 취소)은 훅이 돌지 않는다: 그래서 지시문(틀 memo)이 맡기기 전에 먼저 쓰라고 한다
export class MemoHook {
  static readonly FILE_ENV = 'MOIDA_MEMO_FILE';
  static readonly REASON_ENV = 'MOIDA_MEMO_REASON';
  private static readonly DIR = 'hooks';
  private static readonly SCRIPT_NAME = 'memo-stop.cjs';
  private static readonly SCRIPT = `'use strict';
const fs = require('node:fs');
let input = '';
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  let active = false;
  try { active = JSON.parse(input).stop_hook_active === true; } catch {}
  let memo = '';
  try { memo = fs.readFileSync(process.env.${MemoHook.FILE_ENV} || '', 'utf8').trim(); } catch {}
  if (active || memo) return;
  process.stdout.write(JSON.stringify({ decision: 'block', reason: process.env.${MemoHook.REASON_ENV} || 'memo' }));
});
`;

  /** 설정 폴더의 hooks/에 훅 스크립트를 쓴다 */
  static async install(configDir: string): Promise<void> {
    await mkdir(join(configDir, MemoHook.DIR), { recursive: true });
    await writeFile(join(configDir, MemoHook.DIR, MemoHook.SCRIPT_NAME), MemoHook.SCRIPT);
  }

  /** settings.json의 hooks 칸. 설정 폴더는 CLI가 받은 CLAUDE_CONFIG_DIR로 찾는다 */
  static settings(node: string = process.execPath): object {
    const script = `"$CLAUDE_CONFIG_DIR/${MemoHook.DIR}/${MemoHook.SCRIPT_NAME}"`;
    const command = `${JSON.stringify(node)} ${script}`;
    return { Stop: [{ hooks: [{ type: 'command', command }] }] };
  }
}
