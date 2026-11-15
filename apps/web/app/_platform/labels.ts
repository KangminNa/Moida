import type { SecurityEvent } from './types';

// 보안 기록의 화면 문구 (설정 › 보안). 종류의 이름은 기록하는 모듈이 정한다 (platform은 뜻을 모른다)

/** 종류 → 이름 */
export const SECURITY_KINDS: Readonly<Record<string, string>> = {
  'login.succeeded': '로그인',
  'login.failed': '로그인 실패',
  'login.blocked': '로그인 막힘',
  logout: '로그아웃',
  'session.ended': '로그인 끝내기',
  'password.changed': '비밀번호 바꿈',
  'install.failed': '설치 코드 틀림',
  'device.connected': '기기 연결',
  'device.revoked': '기기 연결 해제',
  'device.token_reused': '갱신 토큰 재사용 · 기기 끊음',
  'runner.paired': '러너 연결',
  'access.denied': '거부된 접근',
};

/** 거르기 (종류의 앞 마디) */
export const SECURITY_GROUPS: readonly (readonly [string, string])[] = [
  ['', '전체'],
  ['login', '로그인'],
  ['session', '로그인 끝내기'],
  ['access', '거부된 접근'],
  ['device', '기기'],
  ['runner', '러너'],
  ['password', '비밀번호'],
  ['install', '설치'],
];

/** 눈여겨볼 사건 (채운 점): 실패 · 막힘 · 거부 · 토큰 재사용 */
export function securityAlert(kind: string): boolean {
  return /\.(failed|blocked|denied|token_reused)$/.test(kind);
}

const METHODS: Readonly<Record<string, string>> = {
  password: '비밀번호',
  install: '설치',
  ended: '하나',
  others: '다른 곳 모두',
  web: '화면에서',
  command: '명령줄에서',
};

const CREDENTIALS: Readonly<Record<string, string>> = {
  bearer: '토큰을 내밂',
  cookie: '쿠키를 내밂',
};

/** 사건의 내용 한 줄 */
export function securityDetail(e: SecurityEvent): string {
  const d = e.detail;
  if (e.kind === 'access.denied')
    return [
      `${d.method ?? ''} ${d.path ?? ''}`.trim(),
      d.status,
      typeof d.credential === 'string' ? (CREDENTIALS[d.credential] ?? d.credential) : null,
    ]
      .filter((v) => v !== null && v !== '')
      .join(' · ');
  const method = typeof d.method === 'string' ? (METHODS[d.method] ?? d.method) : null;
  const login =
    e.kind.startsWith('login.') && e.kind !== 'login.succeeded'
      ? d.login
        ? `아이디 ${d.login}`
        : '다른 아이디'
      : null;
  return [method, login, d.device, typeof d.reason === 'string' ? METHODS[d.reason] : null]
    .filter((v) => v !== null && v !== undefined && v !== '')
    .join(' · ');
}

/** 브라우저 · 기기 이름을 짧게 (모르면 앞부분) */
export function browserOf(userAgent: string | null): string {
  if (!userAgent) return '브라우저 모름';
  const browser = /Edg\//.test(userAgent)
    ? 'Edge'
    : /Chrome\//.test(userAgent)
      ? 'Chrome'
      : /Firefox\//.test(userAgent)
        ? 'Firefox'
        : /Safari\//.test(userAgent)
          ? 'Safari'
          : null;
  const os = /iPhone|iPad/.test(userAgent)
    ? 'iOS'
    : /Android/.test(userAgent)
      ? 'Android'
      : /Mac OS X/.test(userAgent)
        ? 'macOS'
        : /Windows/.test(userAgent)
          ? 'Windows'
          : /Linux/.test(userAgent)
            ? 'Linux'
            : null;
  return browser || os ? [browser, os].filter(Boolean).join(' · ') : userAgent.slice(0, 40);
}
