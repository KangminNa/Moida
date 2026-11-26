'use client';

import { useRouter } from 'next/navigation';
import { type ChangeEvent, useState } from 'react';
import type { SpaceInfo } from '../../_account/types';
import { useApps } from '../../_blog/live';
import { api, uploadFile } from '../../_lib/client-api';
import { useAction } from '../../_lib/use-action';
import { MoidaMark } from '../../_ui/MoidaMark';
import { useNotify } from '../../_ui/notify';
import { BlogForm } from './BlogForm';

/** 서버가 받는 로고 형식 (UploadLogoInput). SVG는 받지 않는다 */
const LOGO_TYPES = 'image/png,image/jpeg,image/webp,image/gif';

// 사이트 정보(이름·소개·주소), 로고, 방문자 첫 화면(스토어 2단계), 백업 받기. 틀(제목)은 page.tsx에 있다.
// 로고를 바꾸면 공간의 version이 올라서, 정보 폼도 그 version으로 새로 만든다 (key)
export function SitePanel({ space: first }: { space: SpaceInfo }) {
  const notify = useNotify();
  const router = useRouter();
  const [space, setSpace] = useState(first);
  const logo = useAction();
  const home = useAction();
  const apps = useApps();
  const open = (apps.data?.apps ?? []).filter((a) => a.visibility === 'public');
  const pinned = open.find((a) => a.home) ?? null;

  /** 방문자 첫 화면(/)을 공개 앱 하나로 고정하거나 자동으로 (PUT /api/apps/home) */
  function pin(appId: string) {
    void home.run('home', () => api('PUT', '/api/apps/home', { appId: appId || null }), {
      done: appId ? '첫 화면 고정함' : '첫 화면 자동',
      reload: apps.reload,
    });
  }

  /** 저장한 공간을 들고, 콘솔 머리(왼쪽 위 로고)도 서버에서 다시 그린다 */
  function saved(next: SpaceInfo) {
    setSpace(next);
    router.refresh();
  }

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const reply = await logo.run(
      'upload',
      () =>
        uploadFile<SpaceInfo>(`/api/space/logo?version=${space.version}`, file, file.type, 'PUT'),
      {
        done: '로고 저장됨',
        conflict: '다른 곳에서 먼저 바뀌었어요. 새로 고친 뒤 다시 올려 주세요',
      },
    );
    if (reply?.ok) saved(reply.data);
  }

  async function remove() {
    const reply = await logo.run(
      'remove',
      () => api<SpaceInfo>('POST', '/api/space/logo/delete', { version: space.version }),
      { done: '로고 뺌', conflict: '다른 곳에서 먼저 바뀌었어요. 새로 고친 뒤 다시 해 주세요' },
    );
    if (reply?.ok) saved(reply.data);
  }

  return (
    <>
      <BlogForm
        key={space.version}
        space={space}
        submitLabel="저장"
        onSaved={(next) => {
          saved(next);
          notify('사이트 정보를 저장했어요');
        }}
      />
      <section className="plugin" aria-label="로고">
        <div className="logo-row">
          <div className="logo-preview">
            {space.logoUrl ? (
              // biome-ignore lint/performance/noImgElement: 작은 로고 하나라 Next의 이미지 최적화를 거치지 않는다
              <img src={space.logoUrl} alt="지금 로고" />
            ) : (
              <MoidaMark size={36} />
            )}
          </div>
          <div className="plugin-head">
            <div>
              <b>로고</b>
              <p>
                콘솔 왼쪽 위 · 블로그 머리 · 브라우저 탭에 보여요. PNG · JPEG · WebP · GIF, 1MB까지
              </p>
            </div>
          </div>
        </div>
        {logo.problem && <p className="error">{logo.problem}</p>}
        <div className="row">
          <label className="ghost file-pick" aria-disabled={logo.busy !== null}>
            {space.logoUrl ? '로고 바꾸기' : '로고 올리기'}
            <input
              type="file"
              accept={LOGO_TYPES}
              hidden
              disabled={logo.busy !== null}
              onChange={(e) => void upload(e)}
            />
          </label>
          {space.logoUrl && (
            <button
              type="button"
              className="ghost"
              disabled={logo.busy !== null}
              onClick={() => void remove()}
            >
              로고 빼기
            </button>
          )}
        </div>
      </section>
      <section className="plugin" aria-label="첫 화면">
        <div className="plugin-head">
          <div>
            <b>첫 화면</b>
            <p>
              방문자가 사이트 주소(/)로 오면 보는 화면. 자동: 공개 앱이 하나면 그 앱, 둘 이상이면 앱
              아이콘 목록
            </p>
          </div>
        </div>
        {(home.problem ?? apps.error) && <p className="error">{home.problem ?? apps.error}</p>}
        <select
          className="input"
          aria-label="첫 화면으로 보일 앱"
          value={pinned?.id ?? ''}
          disabled={home.busy !== null || apps.data === null}
          onChange={(e) => pin(e.target.value)}
        >
          <option value="">자동</option>
          {open.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name} (/{a.slug})
            </option>
          ))}
        </select>
        {open.length === 0 && <small>공개 앱 없음 · 앱을 공개하면 고를 수 있음</small>}
      </section>
      <section className="plugin" aria-label="백업">
        <div className="plugin-head">
          <div>
            <b>백업</b>
            <p>세션, 위키, 글을 보관 형식 zip으로 내려받기</p>
          </div>
        </div>
        <a className="ghost" href="/api/archive.zip" download>
          백업 받기
        </a>
      </section>
    </>
  );
}
