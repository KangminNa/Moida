import { renderMarkdown } from '../_lib/markdown';
import { ago } from '../_lib/time-ago';
import { Slot } from '../_plugins/Slot';
import { AppIcon } from './AppIcon';
import { postPath } from './format';
import { APP_KIND_LABELS } from './labels';
import type { Site } from './site';
import type { PublicApp } from './types';

/** 메일 링크로 왔을 때의 주소 값 (플러그인 email의 구독 확인 · 해지, store.after 자리가 읽는다) */
export type StoreMail = { mail: string | null; token: string | null };

type Post = Site['recent'][number];

// 스토어 첫 화면 (2026-11-26): 회사 · 프로젝트의 첫 화면. 위에서부터 회사 이름과 한 줄 소개, 소개 글(무엇을 왜 하는지),
// 운영하는 사이트(아이콘 · 종류 · 설명 · 마지막 새 글), 새 소식(최근 공개 글), 플러그인 자리(store.after: 메일 구독).
// 글은 모두 콘솔 › 설정 › 사이트에서 정한다 (이름 · 소개 · 한 줄 소개 · 소개 글 · 로고). 서버에서 그린다.
// 사이트 링크는 서버가 준 url (확인한 도메인이면 그 도메인, 스토어 3-0)
export function StoreHome({ site, mail }: { site: Site; mail: StoreMail }) {
  const { space, apps, recent } = site;
  const latest = new Map<string, Post>();
  for (const p of recent) if (p.app && !latest.has(p.app.slug)) latest.set(p.app.slug, p);
  const name = space.name || 'Cairn';
  return (
    <main className="blog-main store">
      <section className="store-hero">
        {space.logoUrl && (
          // biome-ignore lint/performance/noImgElement: 작은 로고 하나라 Next의 이미지 최적화를 거치지 않는다
          <img className="store-logo" src={space.logoUrl} alt="" />
        )}
        {space.tagline && <p className="store-eyebrow">{name}</p>}
        <h1>{space.tagline || name}</h1>
        {space.description && <p className="store-lead">{space.description}</p>}
        {apps.length > 0 && (
          <a className="store-open cta" href="#sites">
            운영하는 사이트 {apps.length}곳
          </a>
        )}
      </section>
      {space.about && (
        <section className="store-section store-about" aria-labelledby="store-about">
          <h2 id="store-about">소개</h2>
          <div
            className="store-about-body"
            // 관리자가 쓴 소개 글: 서버의 md → HTML은 글의 HTML을 그리지 않고 결과를 한 번 더 거른다 (_lib/markdown.ts)
            // biome-ignore lint/security/noDangerouslySetInnerHtml: 위에서 거른 HTML (글 본문 PostArticle과 같다)
            dangerouslySetInnerHTML={{ __html: renderMarkdown(space.about) }}
          />
        </section>
      )}
      <section className="store-section" id="sites" aria-labelledby="store-sites">
        <h2 id="store-sites">운영하는 사이트</h2>
        {apps.length === 0 ? (
          <p className="blog-empty">공개한 사이트 없음</p>
        ) : (
          <ul className="store-sites">
            {apps.map((a) => (
              <SiteCard key={a.slug} app={a} post={latest.get(a.slug) ?? null} />
            ))}
          </ul>
        )}
      </section>
      {recent.length > 0 && <News posts={recent.slice(0, 6)} apps={apps} />}
      {apps.length > 0 && (
        <Slot
          name="store.after"
          context={{
            apps: apps.map((a) => ({ slug: a.slug, name: a.name })),
            mail: mail.mail,
            token: mail.token,
          }}
        />
      )}
    </main>
  );
}

/** 운영하는 사이트 한 장: 카드 전체가 그 사이트로 가는 링크 */
function SiteCard({ app, post }: { app: PublicApp; post: Post | null }) {
  return (
    <li>
      <a className="store-site" href={app.url}>
        <span className="store-site-head">
          <AppIcon app={app} size="small" />
          <span className="store-site-name">
            <strong>{app.name}</strong>
            <span className="store-meta">{APP_KIND_LABELS[app.kind]}</span>
          </span>
        </span>
        {app.description && <span className="store-desc">{app.description}</span>}
        <span className="store-site-foot">
          <span className="store-meta">
            {post?.publishedAt ? `새 글 · ${post.title} · ${ago(post.publishedAt)}` : '새 글 없음'}
          </span>
          <span className="store-open">열기</span>
        </span>
      </a>
    </li>
  );
}

function News({ posts, apps }: { posts: readonly Post[]; apps: readonly PublicApp[] }) {
  const bySlug = new Map(apps.map((a) => [a.slug, a]));
  return (
    <section className="store-section" aria-labelledby="store-news">
      <h2 id="store-news">새 소식</h2>
      <ul className="store-news">
        {posts.map((p) => {
          const app = p.app ? bySlug.get(p.app.slug) : undefined;
          return (
            <li key={`${p.app?.slug ?? ''}/${p.slug}`}>
              <a className="store-news-card" href={postPath(p.slug, p.app?.slug ?? null)}>
                <span className="store-news-app">
                  {app && <AppIcon app={app} size="small" />}
                  <span>{p.app?.name ?? ''}</span>
                  {p.publishedAt && <span className="store-meta">{ago(p.publishedAt)}</span>}
                </span>
                <strong>{p.title}</strong>
                {p.excerpt && <span className="store-desc">{p.excerpt}</span>}
              </a>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
