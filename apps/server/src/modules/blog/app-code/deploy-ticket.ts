import { Forbidden, type SecretBox } from '../../platform';

// 앱 코드 배포 표 (앱 플랫폼, 스토어 12.5). 배포 기기가 MCP(app_code_upload)로 받아 PUT api/apps/<앱>/code/versions의
// 머리글(X-Cairn-Deploy)로 낸다. 기기 토큰은 /mcp에서만 요청자가 되고 JSON 본문은 512KB까지라, 묶음(zip)은 이 표로 받는다
// (결과물의 UploadTicket과 같은 방식). 서버 키로 봉인하고(용도 고정, 10분) 그 앱 · 그때의 마지막 버전 · 크기 · sha256 ·
// 메모에 묶인다: 다른 파일이나 다른 앱에는 쓸 수 없고, 그사이 다른 버전이 생겼으면 받지 않는다.
export class DeployTicket {
  static readonly HEADER = 'x-cairn-deploy';
  private static readonly PURPOSE = 'app-deploy';
  private static readonly TTL_SECONDS = 600;

  constructor(
    readonly spaceId: string,
    readonly appId: string,
    /** 표를 받은 때의 마지막 버전 번호 */
    readonly base: number,
    readonly size: number,
    readonly sha256: string,
    readonly note: string,
  ) {}

  /** 묶음을 낼 경로 */
  get path(): string {
    return `/api/apps/${this.appId}/code/versions`;
  }

  /** 봉인한 표 */
  seal(box: SecretBox, now: Date): string {
    return box.pack(
      DeployTicket.PURPOSE,
      JSON.stringify([this.spaceId, this.appId, this.base, this.size, this.sha256, this.note]),
      DeployTicket.TTL_SECONDS,
      now,
    );
  }

  /** now에 봉인한 표가 끝나는 때 */
  static expiresAt(now: Date): Date {
    return new Date(now.getTime() + DeployTicket.TTL_SECONDS * 1000);
  }

  /** 표를 연다. 없거나 · 틀리거나 · 끝났거나 · 다른 용도면 403 */
  static open(box: SecretBox, token: string | null, now: Date): DeployTicket {
    const value = box.unpack(DeployTicket.PURPOSE, token, now);
    if (value === null)
      throw new Forbidden('deploy_ticket', '배포 표가 맞지 않거나 끝났어요. 다시 배포해 주세요');
    const [spaceId, appId, base, size, sha256, note] = JSON.parse(value) as [
      string,
      string,
      number,
      number,
      string,
      string,
    ];
    return new DeployTicket(spaceId, appId, base, size, sha256, note);
  }
}
