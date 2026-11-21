import { Injectable } from '@nestjs/common';
import { type Actor, BaseQuery, Database, DomainError, NotFound } from '../../platform';
import { LinkPreviewView } from './link-preview.view';
import type { ReadUrlInput } from './web.input';
import { type WebImage, type WebPage, WebPageGateway } from './web-page.gateway';
import { WebReach } from './web-reach.policy';

// 링크 미리보기 (F3, 2026-11-21): 대화의 답에 있는 주소를 서버가 열어 제목 · 사이트 · 설명 · 대표 그림만 읽는다 (관리자만).
// 여는 길은 read_url과 같다 (WebReach · WebPageGateway: 내부망 · 이 서버 막기, 리다이렉트마다 다시 확인, 크기 · 시간 한도).
// 한 번 읽은 주소는 하루, 열지 못한 주소는 10분 기억한다 (프로세스 메모리, KEEP_MAX개). 그림은 미리보기한 페이지의 대표 그림만
// 서버가 받아 준다: 아무 주소의 그림을 대신 받아 주는 길이 되지 않게, 관리자의 브라우저가 바깥 사이트에 직접 닿지 않게.
// 바깥 호출을 기다리는 동안 트랜잭션을 열지 않는다 (DB를 쓰지 않는다)
@Injectable()
export class LinkPreviewQuery extends BaseQuery {
  static readonly KEEP_MS = 24 * 60 * 60 * 1000;
  static readonly FAILED_KEEP_MS = 10 * 60 * 1000;
  static readonly KEEP_MAX = 500;
  /** 주소 → [읽은 때, 페이지 (열지 못했으면 null)] */
  private readonly kept = new Map<string, [number, WebPage | null]>();

  constructor(
    db: Database,
    private readonly pages: WebPageGateway,
  ) {
    super(db);
  }

  async preview(actor: Actor, req: ReadUrlInput): Promise<LinkPreviewView> {
    actor.assertOwner();
    const page = await this.pageAt(req.url);
    const host = req.url.hostname.replace(/^www\./, '');
    if (!page) return new LinkPreviewView(req.url.toString(), '', host, '', false);
    const title = page.title.slice(0, 200);
    return new LinkPreviewView(
      req.url.toString(),
      title,
      page.site || host,
      page.description,
      page.image !== null,
    );
  }

  /** 미리보기한 페이지의 대표 그림 (없으면 404) */
  async image(actor: Actor, req: ReadUrlInput): Promise<WebImage> {
    actor.assertOwner();
    const src = (await this.pageAt(req.url))?.image;
    if (!src) throw new NotFound('미리보기 그림이 없어요');
    return this.pages.image(new URL(src), (url) => WebReach.assertAllowed(url));
  }

  /** 읽은 페이지 (기억한 것이 있으면 그것). 열지 못하면 null (까닭은 카드에 보이지 않는다) */
  private async pageAt(url: URL): Promise<WebPage | null> {
    const key = url.toString();
    const hit = this.kept.get(key);
    if (hit) {
      const keep = hit[1] ? LinkPreviewQuery.KEEP_MS : LinkPreviewQuery.FAILED_KEEP_MS;
      if (Date.now() - hit[0] < keep) return hit[1];
    }
    let page: WebPage | null = null;
    try {
      page = await this.pages.read(url, (u) => WebReach.assertAllowed(u));
    } catch (error) {
      if (!(error instanceof DomainError)) throw error;
    }
    this.kept.delete(key);
    const oldest = this.kept.keys().next();
    if (this.kept.size >= LinkPreviewQuery.KEEP_MAX && !oldest.done) this.kept.delete(oldest.value);
    this.kept.set(key, [Date.now(), page]);
    return page;
  }
}
