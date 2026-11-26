import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import type { Owner, SpaceInfo } from '../_account/types';
import { loginPath, RETURN_HEADER, safeReturnPath } from '../_lib/return-path';
import { serverGet } from '../_lib/server-api';
import type { PluginList } from '../_platform/types';
import { AdminShell } from './AdminShell';
import { SIDE_COOKIE } from './menu';

// 콘솔은 주인만. 로그인하지 않았으면 로그인한 뒤 보던 주소로 돌아온다 (지금 주소는 proxy.ts가 머리글로 붙인다, 웹 UX U2).
export const dynamic = 'force-dynamic';

export const metadata = { title: '콘솔 · Moida', robots: { index: false } };

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const [owner, space, plugins] = await Promise.all([
    serverGet<Owner>('/api/auth/me'),
    serverGet<SpaceInfo>('/api/space'),
    // 기능 패키지 메뉴를 처음부터 그리려고 (화면에서 읽으면 메뉴가 늦게 끼어들어 줄이 밀린다)
    serverGet<PluginList>('/api/plugins'),
  ]);
  if (space && !space.installed) redirect('/install');
  if (!owner) redirect(loginPath(safeReturnPath((await headers()).get(RETURN_HEADER))));
  const sideClosed = (await cookies()).get(SIDE_COOKIE)?.value === 'closed';
  return (
    <AdminShell
      ownerName={owner.name}
      siteName={space?.name ?? ''}
      logoUrl={space?.logoUrl ?? null}
      activePlugins={plugins?.plugins.filter((p) => p.active).map((p) => p.name) ?? []}
      sideClosed={sideClosed}
    >
      {children}
    </AdminShell>
  );
}
