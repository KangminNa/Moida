import type { MemberSelf } from './types';

// 회원이 지금 쓸 수 있는지의 안내 (스토어 3-2, 서버 Member.assertCanWrite와 같은 규칙).
// 막는 일은 서버가 한다: 화면은 보내기 전에 까닭을 보여 주고 버튼을 막을 뿐이다. 시간은 한국 시간 (블로그 화면과 같다)

const WHEN = new Intl.DateTimeFormat('ko-KR', {
  month: 'long',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  timeZone: 'Asia/Seoul',
});

/** 무기한 차단의 끝 (서버 Member.FOREVER) */
const FOREVER_YEAR = '9999';

/** 차단 중이면 안내 (쓰기 · 신고 · 닉네임 바꾸기가 막힌다), 아니면 null */
export function blockNotice(member: MemberSelf, now: number): string | null {
  const until = member.blockedUntil;
  if (until === null || Date.parse(until) <= now) return null;
  return until.startsWith(FOREVER_YEAR)
    ? '운영자가 쓰기를 막았어요 (기한 없음)'
    : `운영자가 ${WHEN.format(new Date(until))}까지 쓰기를 막았어요`;
}

/** 가입 직후 대기 중이면 안내 (글 · 댓글만 막힌다), 아니면 null */
export function waitNotice(member: MemberSelf, now: number): string | null {
  if (Date.parse(member.writableAt) <= now) return null;
  return `가입하고 5분 뒤인 ${WHEN.format(new Date(member.writableAt))}부터 글 · 댓글을 쓸 수 있어요`;
}
