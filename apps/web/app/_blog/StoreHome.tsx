import { renderMarkdown } from '../_lib/markdown';
import { ago } from '../_lib/time-ago';
import { Slot } from '../_plugins/Slot';
import { NewTabLink } from '../_ui/NewTabLink';
import { SOURCE_URL } from '../_ui/source';
import { AppIcon } from './AppIcon';
import { formatDate, postPath } from './format';
import { GatherMark } from './GatherMark';
import { APP_KIND_LABELS } from './labels';
import type { Site } from './site';
import type { PublicApp } from './types';

/** 메일 링크로 왔을 때의 주소 값 (플러그인 email의 구독 확인 · 해지, store.after 자리가 읽는다) */
export type StoreMail = { mail: string | null; token: string | null };

type Post = Site['recent'][number];

// 스토어 첫 화면 (2026-11-26): 회사 · 프로젝트의 첫 화면. 여러 사이트가 한곳에 모이는 모습을 보인다:
//   머리(회사 이름 · 바로 가기 · 로그인) → 점이 모여 되는 큰 이름(GatherMark) · 이름의 뜻 · 한 줄 소개와 사이트 아이콘이 모인 독 → 소개(두 단) →
//   운영하는 사이트 카드 → 새 소식(날짜 줄) → 플러그인 자리(store.after: 메일 구독 띠).
// 글은 모두 콘솔 › 설정 › 사이트에서 정한다 (이름 · 소개 · 한 줄 소개 · 소개 글 · 로고). 서버에서 그린다.
// 사이트 링크는 서버가 준 url (확인한 도메인이면 그 도메인, 스토어 3-0)
export function StoreHome({ site, mail }: { site: Site; mail: StoreMail }) {
  const { space, apps, recent, owner } = site;
  const latest = new Map<string, Post>();
  for (const p of recent) if (p.app && !latest.has(p.app.slug)) latest.set(p.app.slug, p);
  const name = space.name || 'Moida';
  const highlights = glance(space.highlights);
  return (
    <div className="store">
      <header className="store-top">
        <a className="store-brand" href="/store">
          {space.logoUrl && (
            // biome-ignore lint/performance/noImgElement: 작은 로고 하나라 Next의 이미지 최적화를 거치지 않는다
            <img src={space.logoUrl} alt="" />
          )}
          {name}
        </a>
        <nav aria-label="바로 가기">
          {space.highlights && <a href="#glance">한눈에</a>}
          {space.about && <a href="#about">소개</a>}
          {apps.length > 0 && <a href="#sites">사이트</a>}
          {recent.length > 0 && <a href="#news">소식</a>}
          <a className="store-login" href={owner ? '/admin' : '/login'}>
            {owner ? '콘솔' : '로그인'}
          </a>
        </nav>
      </header>
      <main>
        <section className="store-hero">
          <p className="store-eyebrow">
            <span className="store-oss">오픈소스 · AGPL-3.0</span>
            {apps.length > 0 ? `사이트 ${apps.length}곳 운영 중` : '준비 중'}
          </p>
          <GatherMark name={name} />
          {space.naming && <p className="store-naming">{space.naming}</p>}
          {space.tagline ? <h1>{space.tagline}</h1> : <h1 className="store-sr">{name}</h1>}
          {space.description && <p className="store-lead">{space.description}</p>}
          <div className="store-actions">
            {apps.length > 0 && (
              <a className="store-button primary" href="#sites">
                사이트 둘러보기
              </a>
            )}
            <NewTabLink className="store-button" href={SOURCE_URL}>
              GitHub에서 소스 보기
            </NewTabLink>
          </div>
          {apps.length > 0 && (
            <>
              <ul className="store-dock" aria-label="운영하는 사이트">
                {apps.map((a) => (
                  <li key={a.slug}>
                    <a href={a.url} title={a.name}>
                      <AppIcon app={a} size="tile" />
                      <span>{a.name}</span>
                    </a>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
        {highlights.length > 0 && (
          <section className="store-band" id="glance" aria-labelledby="store-glance">
            <div className="store-band-head">
              <h2 id="store-glance">한눈에</h2>
            </div>
            <ol className="store-glance">
              {highlights.map((h) => (
                <li key={h.no}>
                  <span className="store-glance-no">{h.no}</span>
                  <strong>{h.title}</strong>
                  {h.text && <span className="store-desc">{h.text}</span>}
                </li>
              ))}
            </ol>
          </section>
        )}
        {space.about && (
          <section className="store-band store-about" id="about" aria-labelledby="store-about">
            <h2 id="store-about">
              {name}
              {topic(name)}
            </h2>
            <div
              className="store-about-body"
              // 관리자가 쓴 소개 글: 서버의 md → HTML은 글의 HTML을 그리지 않고 결과를 한 번 더 거른다 (_lib/markdown.ts)
              // biome-ignore lint/security/noDangerouslySetInnerHtml: 위에서 거른 HTML (글 본문 PostArticle과 같다)
              dangerouslySetInnerHTML={{ __html: renderMarkdown(space.about) }}
            />
          </section>
        )}
        <section className="store-band" id="sites" aria-labelledby="store-sites">
          <div className="store-band-head">
            <h2 id="store-sites">운영하는 사이트</h2>
            <span>{apps.length}곳</span>
          </div>
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
        {recent.length > 0 && <News posts={recent.slice(0, 6)} />}
        {apps.length > 0 && (
          <div id="subscribe">
            <Slot
              name="store.after"
              context={{
                apps: apps.map((a) => ({ slug: a.slug, name: a.name })),
                mail: mail.mail,
                token: mail.token,
              }}
            />
          </div>
        )}
      </main>
    </div>
  );
}

/** "한눈에" 칸: 한 줄에 하나 ("제목: 설명" 또는 "제목 - 설명", 설명은 없어도 된다). 6줄까지 */
function glance(raw: string): { no: string; title: string; text: string }[] {
  return raw
    .split('\n')
    .map((line) => line.replace(/^[-*\d.\s]+/, '').trim())
    .filter(Boolean)
    .slice(0, 6)
    .map((line, i) => {
      const [title = '', ...rest] = line.split(/:\s|\s-\s/);
      return {
        no: String(i + 1).padStart(2, '0'),
        title: title.trim(),
        text: rest.join(' ').trim(),
      };
    });
}

/** 이름 뒤의 "은/는": 한글 끝 글자에 받침이 있으면 은, 그 밖(영문 이름 포함)은 는 */
function topic(name: string): string {
  const last = name.trim().slice(-1).charCodeAt(0);
  const hangul = last >= 0xac00 && last <= 0xd7a3;
  return hangul && (last - 0xac00) % 28 !== 0 ? '은' : '는';
}

/** 운영하는 사이트 한 장: 카드 전체가 그 사이트로 가는 링크 */
function SiteCard({ app, post }: { app: PublicApp; post: Post | null }) {
  return (
    <li>
      <a className="store-site" href={app.url}>
        <AppIcon app={app} size="tile" />
        <span className="store-site-kind">{APP_KIND_LABELS[app.kind]}</span>
        <strong>{app.name}</strong>
        <span className="store-desc">{app.description || `${app.name}의 새 글을 모아요`}</span>
        <span className="store-site-foot">
          <span className="store-meta">
            {post?.publishedAt ? `${ago(post.publishedAt)} · ${post.title}` : '아직 새 글 없음'}
          </span>
          <span className="store-arrow" aria-hidden="true">
            →
          </span>
        </span>
      </a>
    </li>
  );
}

/** 새 소식: 사이트를 가리지 않고 최근 공개 글을 날짜 줄로 */
function News({ posts }: { posts: readonly Post[] }) {
  return (
    <section className="store-band" id="news" aria-labelledby="store-news">
      <div className="store-band-head">
        <h2 id="store-news">새 소식</h2>
      </div>
      <ul className="store-news">
        {posts.map((p) => (
          <li key={`${p.app?.slug ?? ''}/${p.slug}`}>
            <a href={postPath(p.slug, p.app?.slug ?? null)}>
              <time dateTime={p.publishedAt ?? undefined}>{formatDate(p.publishedAt)}</time>
              <span className="store-news-text">
                <span className="store-news-app">{p.app?.name ?? ''}</span>
                <strong>{p.title}</strong>
                {p.excerpt && <span className="store-desc">{p.excerpt}</span>}
              </span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
