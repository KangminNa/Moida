'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef } from 'react';
import { useSpace } from '../../../_account/live';
import { useApps, usePages } from '../../../_blog/live';
import type { AdminApp } from '../../../_blog/types';
import { api, uploadFile } from '../../../_lib/client-api';
import { SHRINK, shrinkImage } from '../../../_lib/image-shrink';
import { useAction } from '../../../_lib/use-action';
import { CHAT_HREF, STORE_HREF } from '../../menu';
import { type CreateAppBody, CreateAppForm } from './CreateAppForm';

/** 스토어 화면의 주소 */
const STORE_NEW_HREF = `${STORE_HREF}/new`;

// 스토어 (스토어 1-5 → 2026-11-25 A4 앱 하나로): 종류 카드 없이 "새 앱" 하나로 만든다. 만들면 앱 관리로 간다.
// 화면은 모두 앱 코드이고, 대화에서 맡기면 일꾼이 참고할 화면을 찾아 디자인 문서를 쓰고 만든다 (스킬 moida-make).
// 시트는 주소(?make=1, page.tsx가 넘김)에 둔다 (웹 UX U1): 열기는 기록을 하나 쌓고, 닫기는 여기서 연 것이면 뒤로 ·
// 주소로 바로 들어왔으면 바꿔치기, 만든 뒤에는 앱 관리로 바꿔치기한다 (뒤로 가기가 다시 시트를 열지 않게)
export function StorePanel({ make }: { make: string | null }) {
  const router = useRouter();
  const apps = useApps();
  const pages = usePages();
  const save = useAction();
  const sheet = make !== null;
  /** 이 화면에서 시트를 열었는가 (닫을 때 뒤로 갈 수 있는지) */
  const opened = useRef(false);
  const space = useSpace();
  const list = apps.data?.apps ?? [];
  /** 공개 주소 앞부분: 사이트 주소에서 https:// 와 끝 / 를 뺀 것 */
  const origin = (space.data?.siteUrl ?? '').replace(/^https?:\/\//, '').replace(/\/+$/, '');

  /** 만들고 아이콘을 올린 뒤 앱 관리로 (바꿔치기) */
  async function create(body: CreateAppBody, icon: File | null, requestId: string) {
    const made = await save.run('create', () =>
      api<AdminApp>('POST', '/api/apps', { ...body, requestId }),
    );
    if (!made?.ok) return false;
    const app = made.data;
    if (icon) {
      const small = await shrinkImage(icon, SHRINK.icon);
      await save.run('icon', () =>
        uploadFile<AdminApp>(
          `/api/apps/${app.id}/icon?version=${app.version}`,
          small,
          small.type,
          'PUT',
        ),
      );
    }
    router.replace(`${STORE_HREF}/${app.id}`);
    return true;
  }

  function open() {
    save.clear();
    opened.current = true;
    router.push(`${STORE_NEW_HREF}?make=1`, { scroll: false });
  }

  function close() {
    save.clear();
    if (opened.current) router.back();
    else router.replace(STORE_NEW_HREF, { scroll: false });
    opened.current = false;
  }

  return (
    <>
      <header className="page-head">
        <div>
          <h1>스토어</h1>
          <p>새 앱은 빈 화면에서 시작 · 화면은 대화에서 맡기면 참고할 디자인을 찾아 만듦</p>
        </div>
        {!sheet && (
          <button type="button" className="cta small" onClick={open}>
            새 앱
          </button>
        )}
      </header>
      {sheet && (
        <CreateAppForm
          origin={origin}
          pages={(pages.data?.pages ?? []).filter((p) => p.appId === null)}
          busy={save.busy !== null}
          problem={save.problem}
          onSubmit={create}
          onEdit={save.clear}
          onClose={close}
        />
      )}
      {list.length > 0 && (
        <section className="panel stack" aria-label="만든 앱">
          <b>만든 앱</b>
          <p>{list.map((a) => a.name).join(' · ')}</p>
          <Link className="ghost" href={STORE_HREF}>
            내 앱
          </Link>
        </section>
      )}
      <section className="panel stack" aria-label="화면 맡기기">
        <b>화면 맡기기</b>
        <p>
          "빵집 앱 화면 만들어 줘"처럼 대화에서 맡기면 같은 분야의 잘 만든 화면을 찾아 보고 디자인
          문서를 쓴 뒤 만듦. 결과는 대화의 카드에서 승인
        </p>
        <Link className="ghost" href={CHAT_HREF}>
          대화에서 맡기기
        </Link>
      </section>
    </>
  );
}
