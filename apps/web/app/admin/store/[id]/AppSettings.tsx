'use client';

import { useRouter } from 'next/navigation';
import type { ChangeEvent } from 'react';
import { AppIcon } from '../../../_blog/AppIcon';
import type { AdminApp } from '../../../_blog/types';
import { api, uploadFile } from '../../../_lib/client-api';
import { useAction } from '../../../_lib/use-action';
import { STORE_HREF } from '../../menu';
import { type AppSettingsBody, AppSettingsForm } from './AppSettingsForm';

/** 서버가 받는 아이콘 형식 (UploadIconInput). SVG는 받지 않는다 */
const ICON_TYPES = 'image/png,image/jpeg,image/webp,image/gif';
const CONFLICT = '이미 바뀐 앱이에요. 최신 내용을 다시 읽었어요';

// 앱 관리 › 설정 (스토어 1-5): 이름 · 주소 · 설명 · 순서, 아이콘, 삭제(글 · 페이지 · 호가 없을 때만, 빈 메뉴는 함께).
// 아이콘 · 저장은 앱 version이 오르므로 저장 뒤 목록을 다시 읽고 폼을 새로 만든다 (key)
export function AppSettings({
  app,
  onChanged,
}: {
  app: AdminApp;
  onChanged: () => Promise<unknown>;
}) {
  const router = useRouter();
  const save = useAction();
  const icon = useAction();
  const remove = useAction();

  function submit(body: AppSettingsBody) {
    void save.run(
      'save',
      () => api('PATCH', `/api/apps/${app.id}`, { ...body, version: app.version }),
      { done: `${body.name} 저장됨`, reload: onChanged, conflict: CONFLICT },
    );
  }

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    await icon.run(
      'upload',
      () => uploadFile(`/api/apps/${app.id}/icon?version=${app.version}`, file, file.type, 'PUT'),
      { done: '아이콘 저장됨', reload: onChanged, conflict: CONFLICT },
    );
  }

  function dropIcon() {
    void icon.run(
      'remove',
      () => api('POST', `/api/apps/${app.id}/icon/delete`, { version: app.version }),
      { done: '아이콘 뺌', reload: onChanged, conflict: CONFLICT },
    );
  }

  async function drop() {
    if (!window.confirm(`${app.name} 앱을 삭제할까요? 빈 메뉴도 함께 지워지고 되돌릴 수 없어요`))
      return;
    const reply = await remove.run(
      'delete',
      () => api('POST', `/api/apps/${app.id}/delete`, { version: app.version }),
      { done: `${app.name} 삭제`, conflict: CONFLICT },
    );
    if (reply?.ok) router.push(STORE_HREF);
  }

  return (
    <>
      <AppSettingsForm
        key={app.version}
        app={app}
        busy={save.busy !== null}
        problem={save.problem}
        onSubmit={submit}
        onEdit={save.clear}
      />
      <section className="plugin" aria-label="아이콘">
        <div className="logo-row">
          <AppIcon app={app} size="tile" />
          <div className="plugin-head">
            <div>
              <b>아이콘</b>
              <p>공개 첫 화면의 앱 목록 · 앱 머리에 보임. PNG · JPEG · WebP · GIF, 1MB까지</p>
            </div>
          </div>
        </div>
        {icon.problem && <p className="error">{icon.problem}</p>}
        <div className="row">
          <label className="ghost file-pick" aria-disabled={icon.busy !== null}>
            {app.iconUrl ? '아이콘 바꾸기' : '아이콘 올리기'}
            <input
              type="file"
              accept={ICON_TYPES}
              hidden
              disabled={icon.busy !== null}
              onChange={(e) => void upload(e)}
            />
          </label>
          {app.iconUrl && (
            <button
              type="button"
              className="ghost"
              disabled={icon.busy !== null}
              onClick={dropIcon}
            >
              아이콘 빼기
            </button>
          )}
        </div>
      </section>
      <section className="plugin" aria-label="삭제">
        <div className="plugin-head">
          <div>
            <b>앱 삭제</b>
            <p>
              글 · 페이지 · 호가 남아 있으면 삭제할 수 없음. 먼저 다른 앱으로 옮기거나 휴지통으로
            </p>
          </div>
        </div>
        {remove.problem && <p className="error">{remove.problem}</p>}
        <button
          type="button"
          className="ghost"
          disabled={remove.busy !== null}
          onClick={() => void drop()}
        >
          삭제
        </button>
      </section>
    </>
  );
}
