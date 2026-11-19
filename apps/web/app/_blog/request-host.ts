// 요청이 온 호스트 · 프로토콜 (스토어 3-0). 앞단 프록시(Caddy)는 Host를 그대로 넘기고 X-Forwarded-Host · Proto를 붙인다.
// 화면에 주소를 적거나 앱 도메인을 고를 때만 쓴다: 이 값으로 권한을 정하지 않는다 (막는 일은 서버의 HostGate가 한다).

/** 머리글의 호스트 (포트 포함): 앞단 프록시의 X-Forwarded-Host(첫 값), 없으면 Host. 소문자 */
function rawHost(headers: Headers): string {
  const raw = headers.get('x-forwarded-host') || headers.get('host') || '';
  return raw.split(',')[0]?.trim().toLowerCase() ?? '';
}

/** 요청이 온 호스트: 포트와 끝의 점을 뺀다 (앱 도메인과 견준다). 없으면 null */
export function hostOf(headers: Headers): string | null {
  const first = rawHost(headers);
  const host = first.startsWith('[') ? first.slice(0, first.indexOf(']') + 1) : first;
  return host.replace(/:\d*$/, '').replace(/\.$/, '') || null;
}

/** 방문자가 연 출처 (https://<호스트>[:포트]): 앞단 프록시가 https를 풀어 넘겨도 원래 프로토콜로. fallback은 요청의 프로토콜 */
export function originOf(headers: Headers, fallback: string): string {
  const forwarded = headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
  return `${forwarded ? `${forwarded}:` : fallback}//${rawHost(headers).replace(/\.(?=:|$)/, '')}`;
}
