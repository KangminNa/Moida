import { ago } from '../_lib/time-ago';
import { Slot } from '../_plugins/Slot';
import { Icon } from '../_ui/Icon';
import { AppIcon } from './AppIcon';
import { postPath } from './format';
import { APP_KIND_LABELS } from './labels';
import type { Site } from './site';
import type { PublicApp } from './types';

/** 메일 링크로 왔을 때의 주소 값 (플러그인 email의 구독 확인 · 해지, store.after 자리가 읽는다) */
export type StoreMail = { mail: string | null; token: string | null };

type Post = Site['recent'][number];

// 스토어 첫 화면 (2026-11-26 "실제 앱 형태면 좋겠다"): 앱 스토어처럼 위에서부터 사이트 소개, 추천 앱 한 장,
// 앱 목록(아이콘 · 이름 · 종류 · 마지막 새 글 · 열기), 새 소식(최근 공개 글), 그리고 플러그인 자리(store.after: 메일 구독).
// 서버에서 그린다. 앱 링크는 서버가 준 url (확인한 도메인이면 그 도메인, 스토어 3-0)
export function StoreHome({ site, mail }: { site: Site; mail: StoreMail }) {
  const { space, apps, recent } = site;
  const latest = new Map<string, Post>();
  for (const p of recent) if (p.app && !latest.has(p.app.slug)) latest.set(p.app.slug, p);
  const [featured] = apps;
  return (
    <main className="blog-main store">
      <section className="store-hero">
        {space.logoUrl ? (
          // biome-ignore lint/performance/noImgElement: 작은 로고 하나라 Next의 이미지 최적화를 거치지 않는다
          <img className="store-logo" src={space.logoUrl} alt="" />
        ) : (
          <span className="store-logo store-logo-empty" aria-hidden="true">
            <Icon name="site" />
          </span>
        )}
        <div>
          <h1>{space.name || 'Cairn'}</h1>
          {space.description && <p>{space.description}</p>}
          <span className="store-count">앱 {apps.length}개</span>
        </div>
      </section>
      {!featured ? (
        <p className="blog-empty">공개한 앱 없음</p>
      ) : (
        <>
          <FeaturedApp app={featured} post={latest.get(featured.slug) ?? null} />
          <section className="store-section" aria-labelledby="store-apps">
            <h2 id="store-apps">앱</h2>
            <ul className="store-list">
              {apps.map((a) => (
                <AppRow key={a.slug} app={a} post={latest.get(a.slug) ?? null} />
              ))}
            </ul>
          </section>
          {recent.length > 0 && <News posts={recent.slice(0, 6)} apps={apps} />}
          <Slot
            name="store.after"
            context={{
              apps: apps.map((a) => ({ slug: a.slug, name: a.name })),
              mail: mail.mail,
              token: mail.token,
            }}
          />
        </>
      )}
    </main>
  );
}

function FeaturedApp({ app, post }: { app: PublicApp; post: Post | null }) {
  return (
    <a className="store-feature" href={app.url}>
      <span className="store-feature-label">추천 앱</span>
      <span className="store-feature-body">
        <AppIcon app={app} size="tile" />
        <span className="store-feature-text">
          <strong>{app.name}</strong>
          <span>{app.description || APP_KIND_LABELS[app.kind]}</span>
          {post?.publishedAt && (
            <span className="store-meta">
              새 글 · {post.title} · {ago(post.publishedAt)}
            </span>
          )}
        </span>
      </span>
      <span className="store-open cta">열기</span>
    </a>
  );
}

function AppRow({ app, post }: { app: PublicApp; post: Post | null }) {
  return (
    <li className="store-row">
      <a className="store-row-main" href={app.url}>
        <AppIcon app={app} size="small" />
        <span className="store-row-text">
          <strong>{app.name}</strong>
          <span className="store-meta">
            {APP_KIND_LABELS[app.kind]}
            {post?.publishedAt ? ` · ${ago(post.publishedAt)} 업데이트` : ''}
          </span>
          {app.description && <span className="store-desc">{app.description}</span>}
        </span>
      </a>
      <a className="store-open" href={app.url} aria-label={`${app.name} 열기`}>
        열기
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
