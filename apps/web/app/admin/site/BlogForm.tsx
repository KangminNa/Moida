'use client';

import { useEffect, useState } from 'react';
import { useSpace } from '../../_account/live';
import type { SpaceInfo } from '../../_account/types';
import { api } from '../../_lib/client-api';
import { useAction } from '../../_lib/use-action';

type Props = {
  space: SpaceInfo;
  submitLabel: string;
  onSaved: (space: SpaceInfo) => void;
};

// 사이트 이름·소개·스토어 소개(한 줄 · 글)·주소. 설치 마법사의 3단계와 콘솔의 사이트 메뉴가 함께 쓴다.
// version을 함께 보내서, 다른 곳에서 먼저 바꿨으면 덮지 않고 알린다.
export function BlogForm(props: Props) {
  return props.space.version > 0 ? <SpaceForm {...props} /> : <UnsavedSpaceForm {...props} />;
}

/** 저장한 적 없는 값(version 0)을 받았으면 서버의 지금 값으로 맞춘다 (낡은 버전으로 저장하지 않게) */
function UnsavedSpaceForm(props: Props) {
  const now = useSpace().data;
  const space = now && now.version > 0 ? now : props.space;
  return <SpaceForm key={space.version} {...props} space={space} />;
}

function SpaceForm({ space, submitLabel, onSaved }: Props) {
  const save = useAction();
  const [name, setName] = useState(space.name);
  const [description, setDescription] = useState(space.description);
  const [tagline, setTagline] = useState(space.tagline);
  const [about, setAbout] = useState(space.about);
  const [highlights, setHighlights] = useState(space.highlights);
  const [naming, setNaming] = useState(space.naming);
  const [siteUrl, setSiteUrl] = useState(space.siteUrl ?? '');
  const [version, setVersion] = useState(space.version);

  // 아직 정하지 않았으면 지금 연 주소를 미리 넣는다
  useEffect(() => {
    if (!siteUrl) setSiteUrl(window.location.origin);
  }, [siteUrl]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const reply = await save.run(
      'save',
      () =>
        api<SpaceInfo>('PUT', '/api/space', {
          name,
          description,
          tagline,
          about,
          highlights,
          naming,
          siteUrl,
          version,
        }),
      { conflict: '다른 곳에서 먼저 바뀌었어요. 화면을 새로 고친 뒤 다시 저장해 주세요' },
    );
    if (!reply?.ok) return;
    setVersion(reply.data.version);
    onSaved(reply.data);
  }

  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <label className="field">
        <span>이름</span>
        <input
          className="input"
          value={name}
          maxLength={80}
          required
          onChange={(e) => setName(e.target.value)}
          placeholder="예: 회사 이름"
        />
      </label>
      <label className="field">
        <span>소개</span>
        <textarea
          className="input"
          value={description}
          maxLength={300}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="한두 줄로 (비워도 돼요)"
        />
      </label>
      <label className="field">
        <span>한 줄 소개</span>
        <input
          className="input"
          value={tagline}
          maxLength={120}
          onChange={(e) => setTagline(e.target.value)}
          placeholder="예: 우리가 만드는 사이트들을 한곳에서"
        />
        <small>스토어 첫 화면에 크게 보여요 (비워도 돼요)</small>
      </label>
      <label className="field">
        <span>이름의 뜻</span>
        <textarea
          className="input"
          rows={2}
          value={naming}
          maxLength={300}
          onChange={(e) => setNaming(e.target.value)}
          placeholder="예: '모이다'에서 왔어요. 흩어진 기록과 사람이 한곳에 모인다는 뜻이에요"
        />
        <small>
          회사 · 팀 이름을 왜 그렇게 지었는지. 스토어 첫 화면의 큰 이름 아래에 보여요 (비우면
          숨겨요)
        </small>
      </label>
      <label className="field">
        <span>한눈에 (하는 일)</span>
        <textarea
          className="input"
          rows={4}
          value={highlights}
          maxLength={1500}
          onChange={(e) => setHighlights(e.target.value)}
          placeholder={
            '한 줄에 하나씩, "제목: 설명"\n오픈소스: 코드를 공개하고 누구나 내려받아 써요\n여러 사이트: 한 서버에서 블로그 · 매거진 · 앱을 함께 운영해요'
          }
        />
        <small>스토어 첫 화면의 "한눈에" 카드가 돼요 (6줄까지, 비우면 숨겨요)</small>
      </label>
      <label className="field">
        <span>회사 · 프로젝트 소개</span>
        <textarea
          className="input"
          rows={6}
          value={about}
          maxLength={3000}
          onChange={(e) => setAbout(e.target.value)}
          placeholder={
            '무엇을 하려는 곳인지, 어떤 사이트를 왜 운영하는지 (마크다운)\n\n## 하는 일\n- …'
          }
        />
        <small>
          스토어 첫 화면의 "소개"에 보여요. 마크다운으로 제목 · 목록 · 링크를 쓸 수 있어요
        </small>
      </label>
      <label className="field">
        <span>사이트 주소</span>
        <input
          className="input"
          value={siteUrl}
          maxLength={300}
          onChange={(e) => setSiteUrl(e.target.value)}
          placeholder="https://blog.example.com"
        />
        <small>바깥에서 들어오는 https 주소. 이 컴퓨터에서만 쓰면 http://localhost도 가능</small>
      </label>
      {save.problem && <p className="error">{save.problem}</p>}
      <button className="cta" type="submit" disabled={save.busy !== null || !name.trim()}>
        <span>{save.busy ? '저장하는 중' : submitLabel}</span>
        <span className="arr">→</span>
      </button>
    </form>
  );
}
