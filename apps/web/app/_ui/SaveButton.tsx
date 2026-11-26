import { Icon } from './Icon';

// 저장 · 추가 버튼 (2026-11-26 콘솔 인터랙션 3): 누르면 "저장 중", 끝나면 잠깐 체크와 "저장됨"으로 바뀐다.
// 끝난 것은 패널의 동작(useAction().done)이 들고 있어 넘긴다: 저장 뒤 폼이 key로 새로 만들어져도 체크가 남는다.
// 체크는 globals.css의 .action-done (움직임 줄이기면 튀지 않는다)

export function SaveButton({
  busy,
  saved,
  disabled = false,
  label = '저장',
  className = 'cta',
  onClick,
}: {
  busy: boolean;
  /** 방금 끝났는지 (패널의 `action.done === 이름`) */
  saved: boolean;
  disabled?: boolean;
  /** 평소 이름. 바쁠 때는 "<이름> 중", 끝나면 "<이름>됨" */
  label?: string;
  className?: string;
  /** 주면 폼 제출이 아니라 누름으로 (type="button") */
  onClick?: () => void;
}) {
  return (
    <button
      type={onClick ? 'button' : 'submit'}
      className={className}
      disabled={busy || disabled}
      onClick={onClick}
    >
      {saved ? <DoneLabel text={`${label}됨`} /> : busy ? `${label} 중` : label}
    </button>
  );
}

/** 버튼 안의 체크 + 한 줄 (복사 버튼도 쓴다) */
export function DoneLabel({ text }: { text: string }) {
  return (
    <span className="action-done" role="status">
      <Icon name="check" />
      {text}
    </span>
  );
}
