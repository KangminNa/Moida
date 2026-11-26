import { redirect } from 'next/navigation';
import type { Owner } from '../../_account/types';
import { ResetForm } from '../../_install/ResetForm';
import { safeReturnPath } from '../../_lib/return-path';
import { serverGet } from '../../_lib/server-api';

// 관리자 비밀번호 다시 정하기 (2026-11-26): 로그인 메일로 받은 인증코드로 새 비밀번호를 정한다.
// 이미 로그인했으면 설정 › 보안의 비밀번호 바꾸기를 쓰므로 돌아갈 곳으로
export const dynamic = 'force-dynamic';

export default async function ResetPage({
  searchParams,
}: {
  searchParams: Promise<{ return?: string }>;
}) {
  const safe = safeReturnPath((await searchParams).return);
  if (await serverGet<Owner>('/api/auth/me')) redirect(safe);
  return <ResetForm returnTo={safe} />;
}
