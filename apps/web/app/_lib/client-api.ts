import type { ApiError } from './types';

// 브라우저에서 서버 API 부르기. 같은 주소(/api/…)라 쿠키가 함께 간다.
export type ApiReply<T> = { ok: true; data: T } | { ok: false; status: number; error: ApiError };

/** headers: 더 실을 머리글 (커뮤니티 회원 쓰기의 X-Cairn-CSRF, 스토어 3-2) */
export async function api<T>(
  method: string,
  path: string,
  body?: object,
  headers: Readonly<Record<string, string>> = {},
): Promise<ApiReply<T>> {
  return send<T>(path, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
}

/** 파일을 본문 그대로 올린다. 형식은 서버가 파일의 앞부분으로 정한다 */
export async function uploadFile<T>(
  path: string,
  file: File,
  /** 본문의 형식. 서버가 JSON으로 읽지 않게 파일 그대로 보낼 때는 application/octet-stream */
  type = file.type || 'image/png',
  /** 하나뿐인 것을 바꾸는 올리기(사이트 로고)는 PUT */
  method: 'POST' | 'PUT' = 'POST',
): Promise<ApiReply<T>> {
  return send<T>(path, {
    method,
    headers: { 'content-type': type },
    body: file,
  });
}

/**
 * 401 · 403을 받았다는 신호 (웹 UX U2). 로그인이 끝난 콘솔의 관리 API는 403(관리자만)이다.
 * 콘솔 틀(admin/SignedOutBar)이 듣고 로그인이 정말 끝났는지 묻는다 (지금 비밀번호 틀림 · 권한 없음처럼 살아 있어도 오는 답이 있다)
 */
export const DENIED_EVENT = 'cairn:denied';

async function send<T>(path: string, init: RequestInit): Promise<ApiReply<T>> {
  try {
    const res = await fetch(path, init);
    if (res.status === 401 || res.status === 403) window.dispatchEvent(new Event(DENIED_EVENT));
    const json = (await res.json().catch(() => ({}))) as T & ApiError;
    if (res.ok) return { ok: true, data: json };
    return {
      ok: false,
      status: res.status,
      error: {
        code: json.code ?? 'error',
        message: json.message ?? `오류 ${res.status}`,
        fields: json.fields,
      },
    };
  } catch {
    return {
      ok: false,
      status: 0,
      error: { code: 'network', message: '서버에 연결하지 못했어요. 잠시 뒤 다시 해 주세요' },
    };
  }
}

/** 칸 이름 → 화면 이름 (오류가 어느 칸인지 알려줄 때) */
const FIELD_LABELS: Record<string, string> = {
  code: '설치 코드',
  login: '아이디',
  loginId: '아이디',
  nickname: '닉네임',
  body: '본문',
  reason: '까닭',
  password: '비밀번호',
  current: '지금 비밀번호',
  next: '새 비밀번호',
  name: '이름',
  description: '소개',
  siteUrl: '사이트 주소',
  scopes: '권한',
  url: '주소',
  note: '메모',
  title: '제목',
  role: '역할',
  tool: 'AI 도구',
  monthlyLimit: '월 한도',
  instruction: '작업 내용',
};

/** 오류를 사람이 읽는 한 줄로 (필드 오류는 칸 이름과 함께) */
export function describe(error: ApiError): string {
  if (!error.fields) return error.message;
  return Object.entries(error.fields)
    .map(([field, problem]) => {
      const label = FIELD_LABELS[field.split('.')[0] ?? ''];
      return label ? `${label}: ${problem}` : problem;
    })
    .join(' · ');
}
