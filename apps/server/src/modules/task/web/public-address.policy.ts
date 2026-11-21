import { BlockList, isIP } from 'node:net';

// 서버가 대신 여는 바깥 주소의 규칙 (read_url의 WebPageGateway · OAuth 커넥터의 OAuthGateway가 함께 쓴다).
// 이름을 풀어 나온 주소가 밖의 공개 주소인지만 본다: 사설 · 루프백 · 링크 로컬(클라우드 메타데이터) · CGNAT(Tailscale) ·
// 멀티캐스트 · 예약 · 문서용 대역은 막는다. IPv4를 품은 IPv6(::ffff:a.b.c.d)는 안의 IPv4로 본다.
// biome-ignore lint/complexity/noStaticOnlyClass: 상태 없는 판단 한 곳. 두 게이트웨이가 쓴다
export class PublicAddress {
  private static readonly BLOCKED = PublicAddress.blockList();
  private static readonly LOOPBACK = PublicAddress.loopbackList();

  /** 막을 주소인가. loopback: 시험에서만 127.0.0.1 · ::1을 연다 (운영에서 켜지 않는다) */
  static blocked(address: string, loopback: boolean): boolean {
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address)?.[1];
    const ip = mapped ?? address;
    const type = isIP(ip) === 6 ? 'ipv6' : 'ipv4';
    if (loopback && PublicAddress.LOOPBACK.check(ip, type)) return false;
    return PublicAddress.BLOCKED.check(ip, type);
  }

  /** 루프백 주소 그대로 적은 이름인가 (시험의 가짜 서버: 127.0.0.1 · [::1]) */
  static isLoopback(hostname: string): boolean {
    const host = hostname.replace(/^\[|\]$/g, '');
    const family = isIP(host);
    return family !== 0 && PublicAddress.LOOPBACK.check(host, family === 6 ? 'ipv6' : 'ipv4');
  }

  private static blockList(): BlockList {
    const list = new BlockList();
    for (const [net, bits] of [
      ['0.0.0.0', 8],
      ['10.0.0.0', 8],
      ['100.64.0.0', 10],
      ['127.0.0.0', 8],
      ['169.254.0.0', 16],
      ['172.16.0.0', 12],
      ['192.0.0.0', 24],
      ['192.0.2.0', 24],
      ['192.168.0.0', 16],
      ['198.18.0.0', 15],
      ['198.51.100.0', 24],
      ['203.0.113.0', 24],
      ['224.0.0.0', 3],
    ] as const)
      list.addSubnet(net, bits, 'ipv4');
    for (const [net, bits] of [
      ['::', 127],
      ['64:ff9b::', 96],
      ['100::', 64],
      ['2001:db8::', 32],
      ['fc00::', 7],
      ['fe80::', 10],
      ['ff00::', 8],
    ] as const)
      list.addSubnet(net, bits, 'ipv6');
    return list;
  }

  private static loopbackList(): BlockList {
    const list = new BlockList();
    list.addSubnet('127.0.0.0', 8, 'ipv4');
    list.addAddress('::1', 'ipv6');
    return list;
  }
}
