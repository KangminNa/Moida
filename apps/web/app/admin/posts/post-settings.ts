import type { EditablePost, SavedPost } from '../../_blog/types';

// 글 편집기의 발행 창 설정과 그 계산 (PostEditor에서 나눔, 스토어 1-5).

/** 편집기가 다루는 글: 불러온 글이거나 방금 쓴 결과 (둘 다 편집기가 쓰는 칸을 모두 가진다) */
export type LinkedPost = EditablePost | SavedPost;

/** 글 설정 (발행 창에서 고르는 것) */
export type Settings = {
  tags: string;
  slug: string;
  align: 'left' | 'center';
  mainWikiId: string | null;
  refWikiIds: readonly string[];
};

export function settingsOf(post: LinkedPost | null): Settings {
  return post
    ? {
        tags: post.tags.join(', '),
        slug: post.slug,
        align: post.align,
        mainWikiId: post.mainWikiId,
        refWikiIds: post.refWikiIds,
      }
    : { tags: '', slug: '', align: 'left', mainWikiId: null, refWikiIds: [] };
}

/** 고른 순서는 뜻이 없어서 순서 없이 견준다 */
export function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return [...a].sort().join('\n') === [...b].sort().join('\n');
}

export function tagsOf(text: string): string[] {
  return text
    .split(',')
    .map((t) => t.trim().replace(/^#+/, '').trim())
    .filter((t) => t.length > 0);
}
