import { notFound, redirect } from 'next/navigation';
import '../../../_blog/blog.css';
import type { Owner } from '../../../_account/types';
import { loginPath } from '../../../_lib/return-path';
import { serverGet } from '../../../_lib/server-api';
import { PostEditor } from '../PostEditor';
import type { LinkedPost } from '../post-settings';

// 글 편집기 (/admin/posts/new: 새 글, /admin/posts/<id>: 고쳐 쓰기). 주인만.
export const dynamic = 'force-dynamic';

export const metadata = { title: '글 쓰기 · Cairn', robots: { index: false } };

export default async function EditPost({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  /** app: 새 글을 넣을 앱 (앱 관리 › 글의 "새 글") */
  searchParams: Promise<{ app?: string }>;
}) {
  const [{ id }, { app }] = await Promise.all([params, searchParams]);
  const owner = await serverGet<Owner>('/api/auth/me');
  if (!owner)
    redirect(loginPath(`/admin/posts/${id}${app ? `?app=${encodeURIComponent(app)}` : ''}`));
  if (id === 'new') return <PostEditor initial={null} app={app ?? null} />;
  const post = await serverGet<LinkedPost>(`/api/posts/${encodeURIComponent(id)}`);
  if (!post) notFound();
  return <PostEditor initial={post} app={null} />;
}
