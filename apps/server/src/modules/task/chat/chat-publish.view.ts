/** publish_app의 답: 요청의 범위와 바로 반영한 버전 수, 요청이 유효한 마지막 시각 */
export class AppPublishedView {
  constructor(
    private readonly appId: string,
    private readonly scope: string,
    private readonly shown: number,
    private readonly until: Date,
  ) {}

  toJSON() {
    return {
      app_id: this.appId,
      scope: this.scope,
      made_public: this.scope === 'ship',
      versions_shown: this.shown,
      until: this.until.toISOString(),
    };
  }
}
