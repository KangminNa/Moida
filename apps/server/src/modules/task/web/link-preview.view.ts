/**
 * 링크 미리보기 카드 하나 (GET api/link-preview, 2026-11-21). 읽지 못한 페이지는 주소와 호스트만 (카드 대신 링크로 보인다).
 * image는 대표 그림이 있는가: 그림은 GET api/link-preview/image?url=<같은 주소>로 서버를 거쳐 받는다
 */
export class LinkPreviewView {
  constructor(
    private readonly url: string,
    private readonly title: string,
    private readonly site: string,
    private readonly description: string,
    private readonly image: boolean,
  ) {}

  toJSON() {
    return {
      url: this.url,
      title: this.title,
      site: this.site,
      description: this.description,
      image: this.image,
    };
  }
}
