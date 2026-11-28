import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { BaseGateway } from '../../platform';
import type { TermKind } from '../community.tables';

// 약관의 처음 초안 (스토어 3-4). 저장소 apps/server/starters/terms/<종류>.md이고 서버 이미지에 함께 든다 (Dockerfile이 starters를 복사).
// Moida이 회원에게서 무엇을 받는지(아이디 · 닉네임 · 비밀번호 해시 · 글 · 신고, IP · 이메일은 받지 않음)에 맞춘 뼈대일 뿐이라
// 관리자가 운영자 · 연락처 · 시행일을 채우고 읽어 본 뒤 공개한다. {{app}}은 앱 이름으로 바꾼다
export class TermsDraftGateway extends BaseGateway {
  protected readonly name = '약관 초안';
  private readonly cache = new Map<TermKind, string>();

  constructor(private readonly dir: string) {
    super();
  }

  static fromEnv(): TermsDraftGateway {
    return new TermsDraftGateway(resolve(process.cwd(), 'starters', 'terms'));
  }

  /** 종류의 초안 (앱 이름을 넣어서). 파일이 없으면 빈 글 */
  draft(kind: TermKind, appName: string): string {
    let text = this.cache.get(kind);
    if (text === undefined) {
      const path = join(this.dir, `${kind}.md`);
      text = existsSync(path) ? readFileSync(path, 'utf8') : '';
      this.cache.set(kind, text);
    }
    return text.replaceAll('{{app}}', appName);
  }
}
