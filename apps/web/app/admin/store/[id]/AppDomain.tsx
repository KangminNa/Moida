'use client';

import { formatDate } from '../../../_blog/format';
import type { AdminApp } from '../../../_blog/types';
import { api } from '../../../_lib/client-api';
import { useAction } from '../../../_lib/use-action';
import { NewTabLink } from '../../../_ui/NewTabLink';
import { AppDomainForm } from './AppDomainForm';

const CONFLICT = '이미 바뀐 앱이에요. 최신 내용을 다시 읽었어요';
const UNREACHABLE = '도메인에 닿지 못함. DNS · 프록시 설정을 확인한 뒤 다시';

/**
 * 그 도메인의 연결 확인 값 (GET https://<도메인>/.well-known/cairn-domain). 이 브라우저가 직접 읽는다:
 * 서버는 밖으로 요청하지 않는다. 서버가 사이트 주소의 출처만 읽게 하므로 콘솔은 사이트 주소로 열어야 한다
 */
async function readProof(domain: string): Promise<string | null> {
  try {
    const res = await fetch(`https://${domain}/.well-known/cairn-domain`, {
      credentials: 'omit',
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const body = (await res.json().catch(() => null)) as { token?: unknown } | null;
    return typeof body?.token === 'string' ? body.token : null;
  } catch {
    return null;
  }
}

// 앱 관리 › 설정 › 도메인 (스토어 3-0, docs/스토어.md 11.4): 도메인 정하기 · 빼기와 연결 확인.
// 확인한 도메인이어야 기본 도메인의 앱 주소(/<앱>)가 그 도메인으로 간다. 도메인을 바꾸면 다시 확인한다.
export function AppDomain({
  app,
  onChanged,
}: {
  app: AdminApp;
  onChanged: () => Promise<unknown>;
}) {
  const save = useAction();
  const check = useAction();
  const domain = app.domain;

  function submit(next: string) {
    void save.run(
      'save',
      () => api('PATCH', `/api/apps/${app.id}`, { domain: next || null, version: app.version }),
      { done: next ? `${next} 저장됨` : '도메인 뺌', reload: onChanged, conflict: CONFLICT },
    );
  }

  function confirm(target: string) {
    void check.run(
      'check',
      async () => {
        const token = await readProof(target);
        if (token === null)
          return { ok: false, status: 0, error: { code: 'unreachable', message: UNREACHABLE } };
        return api('POST', `/api/apps/${app.id}/domain/check`, { version: app.version, token });
      },
      { done: `${target} 연결됨`, reload: onChanged, conflict: CONFLICT },
    );
  }

  return (
    <section className="plugin" aria-label="도메인">
      <div className="plugin-head">
        <div>
          <b>도메인</b>
          <p>
            이 앱만의 주소. DNS와 앞단 프록시에 도메인을 더한 뒤 연결 확인. 앱 도메인에서는 앱
            화면만 열리고 콘솔은 열리지 않음
          </p>
        </div>
      </div>
      <AppDomainForm
        key={app.version}
        app={app}
        busy={save.busy !== null}
        saved={save.done !== null}
        onSubmit={submit}
        onEdit={save.clear}
      />
      {save.problem && <p className="error">{save.problem}</p>}
      {domain && (
        <div className="row">
          {app.domainCheckedAt ? (
            <small>
              연결됨 · {formatDate(app.domainCheckedAt)} ·{' '}
              <NewTabLink href={app.url}>{app.url}</NewTabLink>
            </small>
          ) : (
            <small>연결 확인 전 · 방문자는 아직 /{app.slug}로</small>
          )}
          <button
            type="button"
            className={app.domainCheckedAt ? 'ghost' : 'cta'}
            disabled={check.busy !== null}
            onClick={() => confirm(domain)}
          >
            {check.busy ? '확인 중' : app.domainCheckedAt ? '다시 확인' : '연결 확인'}
          </button>
        </div>
      )}
      {check.problem && <p className="error">{check.problem}</p>}
      <details>
        <summary>설정 방법</summary>
        <ol>
          <li>DNS: 도메인의 A 레코드(또는 CNAME)를 이 서버로</li>
          <li>
            Caddyfile: 사이트 주소의 블록과 같은 모양으로 도메인 블록 하나 더 (README의 앱 도메인)
          </li>
          <li>여기서 도메인 저장 → 연결 확인</li>
        </ol>
        <pre>{`${domain || 'blog.example.com'} {
	@server path /api/* /.well-known/*
	reverse_proxy @server 127.0.0.1:4000
	reverse_proxy 127.0.0.1:3000
}`}</pre>
      </details>
    </section>
  );
}
