'use client';

import { type FormEvent, useId, useRef, useState } from 'react';
import type { AdminApp, PageList } from '../../../_blog/types';

/** 칸의 길이 (서버 App의 값과 같다) */
const NAME_MAX = 40;
const SLUG_MAX = 30;
const DESCRIPTION_MAX = 200;
/** 서버가 받는 아이콘 형식 (UploadIconInput). SVG는 받지 않는다 */
const ICON_TYPES = 'image/png,image/jpeg,image/webp,image/gif';

/**
 * 쓸 기능 → 앱 종류 (서버 blog.tables의 APP_KIND). 종류는 화면에 내세우지 않는다 (2026-11-25 A4: 앱은 하나,
 * 화면은 모두 앱 코드). 글 · 호 · 회원처럼 Moida이 주는 기능이 필요할 때만 고른다
 */
const FEATURES: readonly [AdminApp['kind'], string, string][] = [
  ['page', '화면만', '도구 · 소개 · 대시보드처럼 앱 코드가 전부인 앱'],
  ['blog', '글', '글 · 메뉴 · RSS. 글은 버전으로 남고 공개는 승인 뒤'],
  ['magazine', '호', '호 단위로 글을 묶어 한 번에 발행'],
  ['community', '회원 글 · 댓글', '가입 · 글 · 댓글 · 신고. 도메인을 연결해야 공개'],
];

/** 만들 때 보내는 본문 (POST /api/apps). requestId는 패널이 붙인다 */
export type CreateAppBody = {
  kind: AdminApp['kind'];
  name: string;
  slug: string;
  description: string;
  menus?: string[];
  pageId?: string;
};

// 앱 만들기 시트 (스토어 1-5 → 2026-11-25 A4 앱 하나로): 이름 · 주소 · 무엇을 하는 앱인지 · 쓸 기능 · 아이콘.
// 종류를 고르는 카드는 없다: 화면은 모두 앱 코드이고, 새 앱은 빈 정적 앱에서 시작해 대화에서 맡기면 일꾼이
// 참고할 화면을 찾아 디자인 문서를 쓰고 만든다 (스킬 moida-make). 글은 시작 메뉴, 화면만이면 앱이 될 페이지(없어도 됨).
// 비공개로 만들어진다. 저장(만들기 → 아이콘 올리기)은 패널이 한다.
export function CreateAppForm({
  origin,
  pages,
  busy,
  problem,
  onSubmit,
  onEdit,
  onClose,
}: {
  /** 공개 주소 앞부분 (사이트 주소) */
  origin: string;
  /** 앱 밖의 페이지 (페이지 앱이 될 수 있는 것) */
  pages: PageList['pages'];
  busy: boolean;
  problem: string | null;
  /** 만들기. 됐으면 true */
  onSubmit: (body: CreateAppBody, icon: File | null, requestId: string) => Promise<boolean>;
  onEdit: () => void;
  onClose: () => void;
}) {
  const id = useId();
  const [kind, setKind] = useState<AdminApp['kind']>('page');
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');
  const [menus, setMenus] = useState('');
  const [pageId, setPageId] = useState('');
  const [icon, setIcon] = useState<File | null>(null);
  const requestId = useRef<string | null>(null);

  function edit(apply: () => void) {
    requestId.current = null;
    onEdit();
    apply();
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const names = menus
      .split(',')
      .map((m) => m.trim())
      .filter(Boolean);
    const body: CreateAppBody = {
      kind,
      name: name.trim(),
      slug: slug.trim(),
      description: description.trim(),
      ...(kind === 'blog' && names.length > 0 ? { menus: names } : {}),
      ...(kind === 'page' && pageId ? { pageId } : {}),
    };
    requestId.current ??= crypto.randomUUID();
    if (await onSubmit(body, icon, requestId.current)) requestId.current = null;
  }

  return (
    <form className="panel stack" onSubmit={submit} aria-label="새 앱 만들기">
      <b>새 앱</b>
      <div className="field">
        <label htmlFor={`${id}-name`}>이름</label>
        <input
          id={`${id}-name`}
          className="input"
          value={name}
          required
          maxLength={NAME_MAX}
          placeholder="예: 동네 빵집"
          onChange={(e) => edit(() => setName(e.target.value))}
        />
      </div>
      <div className="field">
        <label htmlFor={`${id}-slug`}>주소</label>
        <div className="row slug-row">
          <span className="label-mono">{origin}/</span>
          <input
            id={`${id}-slug`}
            className="input"
            value={slug}
            required
            minLength={2}
            maxLength={SLUG_MAX}
            pattern="[a-z0-9]+(-[a-z0-9]+)*"
            placeholder="cooking"
            onChange={(e) => edit(() => setSlug(e.target.value.toLowerCase()))}
          />
        </div>
        <small>영어 소문자 · 숫자 · 하이픈. admin · api · login 같은 이름은 못 씀</small>
      </div>
      <div className="field">
        <label htmlFor={`${id}-description`}>무엇을 하는 앱인지 (공개 첫 화면에 보임)</label>
        <input
          id={`${id}-description`}
          className="input"
          value={description}
          maxLength={DESCRIPTION_MAX}
          placeholder="예: 오늘 나온 빵과 여는 시간을 보고 예약"
          onChange={(e) => edit(() => setDescription(e.target.value))}
        />
      </div>
      <fieldset className="field chips">
        <legend>쓸 기능</legend>
        <div className="row">
          {FEATURES.map(([value, label, help]) => (
            <button
              key={value}
              type="button"
              className="chip"
              aria-pressed={kind === value}
              title={help}
              onClick={() => edit(() => setKind(value))}
            >
              {label}
            </button>
          ))}
        </div>
        <small>{FEATURES.find(([value]) => value === kind)?.[2]} · 나중에 바꿀 수 없음</small>
      </fieldset>
      {kind === 'blog' && (
        <div className="field">
          <label htmlFor={`${id}-menus`}>시작 메뉴 (쉼표로 나눔, 5개까지)</label>
          <input
            id={`${id}-menus`}
            className="input"
            value={menus}
            placeholder="비우면 '글' 하나 · 예: 레시피, 맛집"
            onChange={(e) => edit(() => setMenus(e.target.value))}
          />
        </div>
      )}
      {kind === 'page' && (
        <div className="field">
          <label htmlFor={`${id}-page`}>앱이 될 페이지</label>
          <select
            id={`${id}-page`}
            className="input"
            value={pageId}
            onChange={(e) => edit(() => setPageId(e.target.value))}
          >
            <option value="">없음 · 앱 코드로 화면 만들기</option>
            {pages.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title} ({p.name})
              </option>
            ))}
          </select>
          <small>
            {pages.length === 0 ? '앱 밖의 페이지 없음 · ' : ''}없음이면 앱 관리 › 코드나 대화에서
            화면을 만듦
          </small>
        </div>
      )}
      <div className="field">
        <span>아이콘 (공개 첫 화면의 앱 목록에 보임)</span>
        <label className="ghost file-pick">
          {icon ? icon.name : '그림 올리기'}
          <input
            type="file"
            accept={ICON_TYPES}
            hidden
            onChange={(e) => edit(() => setIcon(e.target.files?.[0] ?? null))}
          />
        </label>
      </div>
      <p className="note">
        비공개로 만들어짐 · 화면은 대화에서 "이 앱 화면 만들어 줘"로 맡김 (참고할 화면을 찾아
        디자인부터)
      </p>
      {problem && <p className="error">{problem}</p>}
      <div className="row">
        <button type="button" className="ghost" onClick={onClose}>
          취소
        </button>
        <button type="submit" className="cta" disabled={busy}>
          {busy ? '만드는 중' : '만들기'}
        </button>
      </div>
    </form>
  );
}
