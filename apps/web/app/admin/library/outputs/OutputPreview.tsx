'use client';

import { useEffect, useState } from 'react';
import { TEXT_MIMES } from '../../../_task/labels';
import type { Output } from '../../../_task/types';
import { NewTabLink } from '../../../_ui/NewTabLink';

/** 결과물 파일의 주소 (늘 내려받기, inline이면 미리 보기) */
export const fileUrl = (output: Output, inline = false) =>
  `/api/outputs/${output.id}/file${inline ? '?inline=1' : ''}`;

/** 미리 보기. 그림 · 영상은 바로, PDF는 새 탭, 글자 파일은 글자로만 (HTML로 그리지 않는다) */
export function Preview({ output, onClose }: { output: Output; onClose: () => void }) {
  const [text, setText] = useState<string | null>(null);
  const isText = TEXT_MIMES.includes(output.mime);

  useEffect(() => {
    if (!isText) return;
    let alive = true;
    void fetch(fileUrl(output))
      .then((res) => (res.ok ? res.text() : '읽지 못했어요'))
      .then((body) => alive && setText(body));
    return () => {
      alive = false;
    };
  }, [output, isText]);

  return (
    <section className="panel" aria-label={`미리 보기: ${output.name}`}>
      <div className="sec-title flat">
        <h2>{output.name}</h2>
        <button type="button" className="ghost" onClick={onClose}>
          닫기
        </button>
      </div>
      {output.mime.startsWith('image/') && (
        // biome-ignore lint/performance/noImgElement: 주인만 받는 파일이라 Next의 이미지 최적화를 거치지 않는다
        <img className="output-preview" src={fileUrl(output, true)} alt={output.name} />
      )}
      {output.mime.startsWith('video/') && (
        // biome-ignore lint/a11y/useMediaCaption: AI가 만든 영상에는 자막 파일이 없다
        <video className="output-preview" src={fileUrl(output, true)} controls />
      )}
      {output.mime === 'application/pdf' && (
        <NewTabLink className="ghost" href={fileUrl(output, true)}>
          새 탭에서 열기
        </NewTabLink>
      )}
      {isText && <pre className="raw">{text ?? '불러오는 중…'}</pre>}
    </section>
  );
}
