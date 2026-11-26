'use client';

import { type FormEvent, useId, useState } from 'react';
import type { AdminApp } from '../../../_blog/types';
import { SaveButton } from '../../../_ui/SaveButton';

/** 도메인 칸에 받는 글자 (서버는 253자 도메인만 받는다) */
const DOMAIN_MAX = 253;

// 앱 관리 › 설정 › 도메인의 칸 (스토어 3-0): 도메인 하나. 모양 검사는 서버가 한다 (https:// · 포트 · 경로 · IP는 422). 저장은 패널이 한다.
export function AppDomainForm({
  app,
  busy,
  saved,
  onSubmit,
  onEdit,
}: {
  app: AdminApp;
  busy: boolean;
  /** 방금 저장이 끝났는지 (버튼이 잠깐 체크) */
  saved: boolean;
  /** 빈 글자면 빼기 */
  onSubmit: (domain: string) => void;
  onEdit: () => void;
}) {
  const id = useId();
  const [domain, setDomain] = useState(app.domain ?? '');

  function submit(event: FormEvent) {
    event.preventDefault();
    onSubmit(domain.trim());
  }

  return (
    <form className="row" onSubmit={submit} aria-label="도메인">
      <label htmlFor={`${id}-domain`}>도메인</label>
      <input
        id={`${id}-domain`}
        className="input"
        value={domain}
        placeholder="blog.example.com"
        maxLength={DOMAIN_MAX}
        autoCapitalize="none"
        spellCheck={false}
        onChange={(e) => {
          onEdit();
          setDomain(e.target.value);
        }}
      />
      <SaveButton busy={busy} saved={saved} disabled={domain.trim() === (app.domain ?? '')} />
    </form>
  );
}
