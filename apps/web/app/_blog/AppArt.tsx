import type { PublicApp } from './types';

// 앱 종류마다 점 · 선으로 그린 그림 (지도 · 커뮤니티 · 글 · 매거진). 앱 카드(AppsDeck)에서 아직 보일 글이 없을 때 그 자리를 채운다.
// 색은 글자색(currentColor)을 따른다: 밝은 카드 위에서는 어둡게

export function AppArt({ kind }: { kind: PublicApp['kind'] }) {
  if (kind === 'community')
    return (
      <span className="fd-art" aria-hidden="true">
        <span className="fd-ring" style={{ transform: 'translate(-24%, -14%)' }} />
        <span className="fd-ring" style={{ transform: 'translate(24%, -14%)' }} />
        <span className="fd-ring fd-dots" style={{ transform: 'translate(0, 22%)' }} />
      </span>
    );
  if (kind === 'blog')
    return (
      <span className="fd-art" aria-hidden="true">
        <span className="fd-text">
          <span className="fd-dots fd-photo" />
          {[100, 84, 92, 56].map((w) => (
            <span key={w} className="fd-ln" style={{ width: `${w}%` }} />
          ))}
        </span>
      </span>
    );
  if (kind === 'magazine')
    return (
      <span className="fd-art" aria-hidden="true">
        <span className="fd-mag">
          <span className="fd-dots fd-mag-cover" />
          <span className="fd-cell" />
          <span className="fd-cell fd-solid" />
          <span className="fd-cell" />
          <span className="fd-cell" />
          <span className="fd-cell fd-dots" />
        </span>
      </span>
    );
  return (
    <span className="fd-art" aria-hidden="true">
      <span className="fd-orb" />
      <span className="fd-dots fd-disc" />
      <span className="fd-pin" style={{ left: '40%', top: '38%' }} />
      <span className="fd-pin" style={{ left: '56%', top: '31%' }} />
      <span className="fd-pin" style={{ left: '52%', top: '60%' }} />
    </span>
  );
}
