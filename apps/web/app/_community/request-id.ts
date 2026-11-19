// 회원 화면의 만들기 요청 id (requestId: 응답을 못 받아 다시 눌러도 하나만 생기게). UUID v4 모양.
// crypto.randomUUID는 보안 출처(https · localhost)에만 있어, http로 연 앱 도메인(개발 · 시험)에서도 되게 getRandomValues로 만든다
export function newRequestId(): string {
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = ((b[6] ?? 0) & 0x0f) | 0x40;
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
