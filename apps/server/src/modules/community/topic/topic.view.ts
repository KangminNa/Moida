import type { CommentRow, TopicRow } from '../community.tables';

/** 작성자는 닉네임만 보인다 (회원 id는 다른 사람에게 싣지 않는다) */
function author(nickname: string) {
  return { nickname };
}

/** 글 목록의 한 줄 (보이는 글, 최근부터). excerpt: 본문 앞부분, comments: 보이는 댓글 수 */
export class TopicLineView {
  constructor(
    private readonly r: Pick<TopicRow, 'id' | 'title' | 'body' | 'created_at' | 'edited_at'> & {
      nickname: string;
      comments: number;
    },
  ) {}

  toJSON() {
    const r = this.r;
    return {
      id: r.id,
      title: r.title,
      excerpt: r.body.replace(/\s+/g, ' ').trim().slice(0, 140),
      author: author(r.nickname),
      comments: Number(r.comments),
      createdAt: r.created_at.toISOString(),
      editedAt: r.edited_at?.toISOString() ?? null,
    };
  }
}

/** 글 목록 (GET /api/community/topics). nextCursor: 다음 쪽을 읽을 때 보낼 값, 끝이면 null */
export class TopicListView {
  constructor(
    private readonly topics: readonly TopicLineView[],
    private readonly nextCursor: string | null,
  ) {}

  toJSON() {
    return { topics: this.topics.map((t) => t.toJSON()), nextCursor: this.nextCursor };
  }
}

/** 글에 달린 댓글 하나 (보이는 것만). mine: 이 회원의 댓글이면 지우기에 쓸 version을 함께 */
export class TopicCommentView {
  constructor(
    private readonly r: Pick<CommentRow, 'id' | 'body' | 'created_at' | 'version'> & {
      nickname: string;
    },
    private readonly mine: boolean,
  ) {}

  toJSON() {
    const r = this.r;
    return {
      id: r.id,
      body: r.body,
      author: author(r.nickname),
      createdAt: r.created_at.toISOString(),
      mine: this.mine,
      ...(this.mine ? { version: r.version } : {}),
    };
  }
}

/** 글 하나와 보이는 댓글 (GET /api/community/topics/:id, 오래된 댓글부터). mine이면 고치기에 쓸 version을 함께 */
export class TopicView {
  constructor(
    private readonly r: Pick<
      TopicRow,
      'id' | 'title' | 'body' | 'created_at' | 'edited_at' | 'version'
    > & {
      nickname: string;
    },
    private readonly mine: boolean,
    private readonly comments: readonly TopicCommentView[],
  ) {}

  toJSON() {
    const r = this.r;
    return {
      id: r.id,
      title: r.title,
      body: r.body,
      author: author(r.nickname),
      createdAt: r.created_at.toISOString(),
      editedAt: r.edited_at?.toISOString() ?? null,
      mine: this.mine,
      ...(this.mine ? { version: r.version } : {}),
      comments: this.comments.map((c) => c.toJSON()),
    };
  }
}

/** 쓰기의 답: 쓴 회원 자신에게 (만들기 · 고치기) */
export class TopicSavedView {
  constructor(
    private readonly r: Pick<
      TopicRow,
      'id' | 'title' | 'body' | 'created_at' | 'edited_at' | 'version'
    >,
  ) {}

  toJSON() {
    const r = this.r;
    return {
      id: r.id,
      title: r.title,
      body: r.body,
      createdAt: r.created_at.toISOString(),
      editedAt: r.edited_at?.toISOString() ?? null,
      version: r.version,
    };
  }
}
