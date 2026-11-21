'use client';

import { type FormEvent, useId, useRef, useState } from 'react';
import type { ExternalTool } from '../../_task/types';

/** 칸의 길이 (서버 ExternalTool · ExternalToolUrl의 값과 같다) */
const NAME_MAX = 30;
const TITLE_MAX = 60;
const URL_MAX = 500;
const SECRET_MAX = 4000;

/** 로그인 방식 (C1): header = 고정 토큰을 머리글에, oauth = 서버가 연 OAuth 로그인 */
type Auth = ExternalTool['auth'];

/** 저장할 때 보내는 본문 (POST · PATCH /api/external-tools). 만들기의 requestId와 고치기의 version은 패널이 붙인다 */
export type ExternalToolBody = {
  name?: string;
  title: string;
  url: string;
  auth: Auth;
  headerName: string | null;
  secret?: string;
};

// 외부 도구 하나를 더하거나 고치는 폼 (2차 7단계): 칸의 상태와 보낼 본문만 가진다. 저장은 패널이 돌린다.
// 이름은 만들 때만 정한다 (러너 안의 MCP 서버 이름 x-<이름>). 토큰은 만들 때 넣거나, 나중에 "토큰 넣기"로.
// OAuth 로그인(C1)이면 머리글 · 토큰 칸이 없고, 저장한 뒤 목록의 "로그인"으로 그 서비스에서 승인한다.
export function ExternalToolForm({
  tool,
  busy,
  problem,
  onSubmit,
  onEdit,
  onClose,
}: {
  /** 고칠 도구. 없으면 새로 더한다 */
  tool: ExternalTool | null;
  busy: boolean;
  problem: string | null;
  /** 저장. 됐으면 true */
  onSubmit: (body: ExternalToolBody, requestId: string) => Promise<boolean>;
  onEdit: () => void;
  onClose: () => void;
}) {
  const id = useId();
  const [name, setName] = useState(tool?.name ?? '');
  const [title, setTitle] = useState(tool?.title ?? '');
  const [url, setUrl] = useState(tool?.url ?? '');
  const [auth, setAuth] = useState<Auth>(tool?.auth ?? 'header');
  const [headerName, setHeaderName] = useState(tool?.headerName ?? '');
  const [secret, setSecret] = useState('');
  // 같은 내용을 다시 보내면 같은 requestId: 응답을 놓쳐 다시 눌러도 도구는 하나다
  const requestId = useRef<string | null>(null);

  function change(apply: () => void) {
    requestId.current = null;
    onEdit();
    apply();
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    requestId.current ??= crypto.randomUUID();
    const header = auth === 'oauth' ? null : headerName.trim() || null;
    const body: ExternalToolBody = {
      title: title.trim(),
      url: url.trim(),
      auth,
      headerName: header,
    };
    const extra = tool ? {} : { name: name.trim(), ...(header && secret ? { secret } : {}) };
    if (await onSubmit({ ...body, ...extra }, requestId.current)) setSecret('');
  }

  return (
    <form
      className="panel"
      onSubmit={submit}
      aria-label={tool ? `${tool.title} 편집` : '외부 도구 추가'}
    >
      {!tool && (
        <div className="field">
          <label htmlFor={`${id}-name`}>이름</label>
          <input
            id={`${id}-name`}
            className="input"
            value={name}
            required
            maxLength={NAME_MAX}
            pattern="[a-z][a-z0-9\-]{1,29}"
            placeholder="notion"
            aria-describedby={`${id}-name-help`}
            onChange={(e) => change(() => setName(e.target.value))}
          />
          <small id={`${id}-name-help`}>영문 소문자 · 숫자 · -. 만든 뒤 바꿀 수 없음</small>
        </div>
      )}
      <div className="field">
        <label htmlFor={`${id}-title`}>이름표</label>
        <input
          id={`${id}-title`}
          className="input"
          value={title}
          required
          maxLength={TITLE_MAX}
          placeholder="Notion"
          onChange={(e) => change(() => setTitle(e.target.value))}
        />
      </div>
      <div className="field">
        <label htmlFor={`${id}-url`}>MCP 주소</label>
        <input
          id={`${id}-url`}
          className="input"
          type="url"
          value={url}
          required
          maxLength={URL_MAX}
          placeholder="https://mcp.example.com/mcp"
          aria-describedby={`${id}-url-help`}
          onChange={(e) => change(() => setUrl(e.target.value))}
        />
        <small id={`${id}-url-help`}>https 원격 MCP만. 내부망 · IP 주소는 안 됨</small>
      </div>
      <div className="field">
        <label htmlFor={`${id}-auth`}>로그인 방식</label>
        <select
          id={`${id}-auth`}
          className="input"
          value={auth}
          aria-describedby={`${id}-auth-help`}
          onChange={(e) => change(() => setAuth(e.target.value === 'oauth' ? 'oauth' : 'header'))}
        >
          <option value="header">토큰</option>
          <option value="oauth">OAuth 로그인</option>
        </select>
        <small id={`${id}-auth-help`}>
          {auth === 'oauth'
            ? '저장한 뒤 "로그인"으로 그 서비스에서 승인. 토큰은 서버가 잠가 두고 갱신함'
            : '정해진 토큰을 머리글에 실음'}
          {tool && tool.auth !== auth ? '. 바꾸면 넣어 둔 토큰 · 로그인을 지움' : ''}
        </small>
      </div>
      {auth === 'header' && (
        <div className="field">
          <label htmlFor={`${id}-header`}>토큰 머리글</label>
          <input
            id={`${id}-header`}
            className="input"
            value={headerName}
            maxLength={40}
            placeholder="Authorization"
            aria-describedby={`${id}-header-help`}
            onChange={(e) => change(() => setHeaderName(e.target.value))}
          />
          <small id={`${id}-header-help`}>
            토큰이 필요 없으면 비움. 비우면 넣어 둔 토큰도 지움
          </small>
        </div>
      )}
      {!tool && auth === 'header' && headerName.trim() !== '' && (
        <div className="field">
          <label htmlFor={`${id}-secret`}>토큰</label>
          <input
            id={`${id}-secret`}
            className="input"
            type="password"
            autoComplete="off"
            value={secret}
            maxLength={SECRET_MAX}
            placeholder="Bearer …"
            aria-describedby={`${id}-secret-help`}
            onChange={(e) => change(() => setSecret(e.target.value))}
          />
          <small id={`${id}-secret-help`}>머리글에 그대로 실림. 저장한 뒤 다시 보이지 않음</small>
        </div>
      )}
      {problem && <p className="error">{problem}</p>}
      <div className="row">
        <button type="submit" className="cta small" disabled={busy}>
          {busy ? '저장 중' : '저장'}
        </button>
        <button type="button" className="ghost" onClick={onClose}>
          닫기
        </button>
      </div>
    </form>
  );
}
