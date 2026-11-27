import { OUTPUT_KINDS } from '../../_task/labels';
import { OutputOpen } from '../../_task/parts';
import type { ChatTurn } from '../../_task/types';
import { NewTabLink } from '../../_ui/NewTabLink';

/** 대화 안에서 바로 보이는 결과물 종류: 서버가 파일 앞부분으로 알아본 그림 · 영상 (?inline=1이 받는 형식) */
const MEDIA = ['image', 'video'];

// 회차의 결과물 (2026-11-27, 사용자 "대화에서 이미지나, 글이나 좀 잘 보여줄 수 없어?"):
// 그림은 답 아래에 바로 크게, 영상은 그 자리에서 재생한다. 누르면 새 탭에서 원본 크기로 (서버의 view=1).
// 그 밖의 파일(문서 · 표 · HTML)은 지금처럼 이름 한 줄과 열기 · 내려받기
export function ChatOutputs({ outputs }: { outputs: ChatTurn['outputs'] }) {
  if (outputs.length === 0) return null;
  const media = outputs.filter((o) => MEDIA.includes(o.kind));
  const files = outputs.filter((o) => !MEDIA.includes(o.kind));
  return (
    <>
      {media.length > 0 && (
        <ul className={`chat-media${media.length === 1 ? ' one' : ''}`} aria-label="그림 · 영상">
          {media.map((o) => (
            <li key={o.id}>
              {o.kind === 'video' ? (
                // biome-ignore lint/a11y/useMediaCaption: AI가 만든 결과물 영상이라 자막 파일이 없다
                <video src={`/api/outputs/${o.id}/file?inline=1`} controls preload="metadata" />
              ) : (
                <NewTabLink href={`/api/outputs/${o.id}/file?view=1`}>
                  {/* biome-ignore lint/performance/noImgElement: 서버가 내주는 결과물 파일이라 Next의 이미지 최적화를 거치지 않는다 */}
                  <img src={`/api/outputs/${o.id}/file?inline=1`} alt={o.name} loading="lazy" />
                </NewTabLink>
              )}
              <span className="chat-media-name">{o.name}</span>
            </li>
          ))}
        </ul>
      )}
      {files.length > 0 && (
        <ul className="list" aria-label="결과물">
          {files.map((o) => (
            <li key={o.id} className="list-cell output-row">
              <div className="output-main">
                <b>{o.name}</b>
                <small>{OUTPUT_KINDS[o.kind] ?? o.kind}</small>
              </div>
              <OutputOpen id={o.id} name={o.name} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
