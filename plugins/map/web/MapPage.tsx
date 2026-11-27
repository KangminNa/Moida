import { useCallback, useEffect, useState } from 'react';

// map의 콘솔 화면 (운영 › 지도, docs/지도.md MP-3): 장소 · 주소 찾기를 오늘 몇 번 불렀는지와 하루 한도.
// 같은 질문 10분 안의 다시 묻기는 세지 않는다. 지도 회사 · 키는 설정 › 플러그인 › map.
// 화면은 react와 이 폴더만 가져온다 (call · notify는 콘솔이 넘긴다).

type Reply = { ok: true; data: unknown } | { ok: false; message: string };
type Props = {
  call: (method: string, path: string, body?: object) => Promise<Reply>;
  notify: (text: string) => void;
};
type Usage = { provider: string; ready: boolean; today: number; limit: number };

const NAMES: Record<string, string> = { kakao: '카카오', naver: '네이버', google: '구글' };

export default function MapPage({ call, notify }: Props) {
  const [usage, setUsage] = useState<Usage | null>(null);

  const load = useCallback(async () => {
    const reply = await call('GET', 'usage');
    if (reply.ok) setUsage(reply.data as Usage);
    else notify(reply.message);
  }, [call, notify]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!usage) return <p className="note">불러오는 중</p>;
  if (!usage.ready)
    return (
      <section aria-label="지도 찾기" className="panel">
        <p>장소 · 주소 찾기 꺼짐</p>
        <small className="note">
          설정 › 플러그인 › map에서 찾기 회사와 서버 키를 넣으면 켜져요. 지도 그리기는 찾기 없이도
          돼요
        </small>
      </section>
    );
  const left = Math.max(0, usage.limit - usage.today);
  return (
    <section aria-label="지도 찾기" className="panel">
      <p>
        오늘 찾기 {usage.today.toLocaleString()} / {usage.limit.toLocaleString()}번
      </p>
      {left === 0 ? (
        <p className="error">오늘 한도를 다 써서 내일(UTC)까지 찾기가 멈춰요</p>
      ) : (
        <small className="note">남은 {left.toLocaleString()}번</small>
      )}
      <small className="note">
        {NAMES[usage.provider] ?? usage.provider} 찾기 · 날은 UTC 기준 · 같은 질문 10분 안의 다시
        묻기는 세지 않아요 · 서버를 다시 켜면 0부터 다시 세요
      </small>
      <button type="button" className="text-button" onClick={() => void load()}>
        새로 고침
      </button>
    </section>
  );
}
