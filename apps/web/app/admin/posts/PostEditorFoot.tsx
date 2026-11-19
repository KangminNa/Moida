import { postPath } from '../../_blog/format';
import { NewTabLink } from '../../_ui/NewTabLink';
import type { LinkedPost } from './post-settings';

// 편집기 아래 줄: 공개된 글이면 글 보기(새 탭, 웹 UX U3), 휴지통에 없는 글이면 휴지통으로
export function PostEditorFoot({
  post,
  onTrash,
}: {
  post: LinkedPost | null;
  onTrash: () => void;
}) {
  const trashed = post?.deletedAt != null;
  return (
    <footer className="editor-foot">
      {post && post.status !== 'draft' && !trashed ? (
        <NewTabLink className="ghost" href={postPath(post.slug, null)}>
          글 보기 ↗
        </NewTabLink>
      ) : (
        <span />
      )}
      {post && !trashed && (
        <button type="button" className="ghost danger" onClick={onTrash}>
          휴지통으로
        </button>
      )}
    </footer>
  );
}
