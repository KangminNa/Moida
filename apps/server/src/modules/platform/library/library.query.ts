import { Injectable } from '@nestjs/common';
import type { Actor } from '../base/actor';
import { BaseQuery } from '../base/base-query';
import { LibraryInput } from './library.input';
import { LibraryPageView, type LibraryRow } from './library.view';

/** 등록된 읽기 하나: 그 읽기가 돌려주는 종류들과 읽기 */
class LibrarySource {
  constructor(
    readonly kinds: readonly string[],
    readonly read: (actor: Actor, filter: LibraryInput) => Promise<readonly LibraryRow[]>,
  ) {}
}

// 보관함 (2차 5단계): 결과물 · 페이지 · 읽은 글 · 세션 · 위키 · 글을 한 목록으로. platform은 다른 모듈의 표를 모르므로
// 내용을 가진 모듈이 onModuleInit에서 자기 읽기를 등록한다 (ArchiveQuery와 같은 방식).
//
//   library.register(['session'], (actor, filter) => this.sessions.library(actor, filter));
//
// 읽기는 거르기(종류 · 프로젝트 · 기간 · 커서)를 지켜 최근 것부터 한 쪽보다 하나 더까지 돌려준다.
// 여기서는 모아서 시간 → id 순으로 한 쪽만 남긴다. 표에 사본을 두지 않는다 (원본이 바뀌면 그대로 보인다)
@Injectable()
export class LibraryQuery extends BaseQuery {
  private readonly sources: LibrarySource[] = [];

  register(
    kinds: readonly string[],
    read: (actor: Actor, filter: LibraryInput) => Promise<readonly LibraryRow[]>,
  ): void {
    const taken = kinds.filter((k) => this.sources.some((s) => s.kinds.includes(k)));
    if (taken.length > 0) throw new Error(`이미 등록된 보관함 종류예요: ${taken.join(', ')}`);
    this.sources.push(new LibrarySource(kinds, read));
  }

  /** 보관함 한 쪽 (주인만: 비공개가 섞인다) */
  async list(actor: Actor, filter: LibraryInput): Promise<LibraryPageView> {
    actor.assertOwner();
    const wanted = this.sources.filter((s) => s.kinds.some((k) => filter.wants(k)));
    const rows = (await Promise.all(wanted.map((s) => s.read(actor, filter)))).flat();
    rows.sort((a, b) => b.at.getTime() - a.at.getTime() || (a.id < b.id ? 1 : -1));
    const { items, next } = this.pageOf(rows, LibraryInput.PAGE, (last) =>
      LibraryInput.cursorAfter(last.at, last.id),
    );
    return new LibraryPageView(items, next);
  }

  /**
   * id들이 무엇인지 (대화의 참조, 2026-11-15 B): 종류 · 제목 · 공개 범위. 없거나 휴지통에 있는 id는 빠진다 (주인만).
   * 모든 종류에 묻는다: id는 UUIDv7이라 종류끼리 겹치지 않는다
   */
  async describe(actor: Actor, ids: readonly string[]): Promise<readonly LibraryRow[]> {
    actor.assertOwner();
    if (ids.length === 0) return [];
    const filter = LibraryInput.forIds(ids);
    return (await Promise.all(this.sources.map((s) => s.read(actor, filter)))).flat();
  }
}
