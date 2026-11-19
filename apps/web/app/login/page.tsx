import { redirect } from 'next/navigation';
import type { LoginMethodList, Owner } from '../_account/types';
import { LoginForm } from '../_install/LoginForm';
import { safeReturnPath } from '../_lib/return-path';
import { serverGet } from '../_lib/server-api';

// 로그인. ?return=/install 처럼 돌아갈 곳을 받을 수 있다 (이 사이트 안의 경로만, safeReturnPath).
// 외부 로그인(로그인 플러그인)에서 실패하면 ?error=이유 로 돌아온다.
export const dynamic = 'force-dynamic';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ return?: string; error?: string }>;
}) {
  const { return: back, error } = await searchParams;
  const safe = safeReturnPath(back);
  // 이미 로그인했으면 폼 없이 돌아갈 곳으로 (뒤로 가기로 왔을 때도, 웹 UX U1)
  if (await serverGet<Owner>('/api/auth/me')) redirect(safe);
  const methods = (await serverGet<LoginMethodList>('/api/auth/methods'))?.methods ?? [];
  return <LoginForm returnTo={safe} methods={methods} initialError={error ?? null} />;
}
