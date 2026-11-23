import { useCallback, useEffect, useState } from 'react';

// messenger-telegram의 콘솔 화면 (운영 › 텔레그램). 텔레그램 봇으로 대표와 대화한다.
//   연결 코드: 받은 코드를 봇에게 보낸 텔레그램 계정이 이 공간에 이어진다 (10분, 한 번만)
//   이어 둔 계정: 그 계정의 말만 대표에게 가고, 텔레그램에서 쓴 대화의 답 · 결과 카드 알림이 돌아간다
// 승인은 콘솔에서만 한다. 봇 토큰 · 바깥 주소 · 웹훅 연결은 설정 › 플러그인 › messenger-telegram.
// 화면은 react와 이 폴더만 가져온다: 서버 호출(call)과 알림(notify)은 콘솔이 넘겨 준다.

type Reply = { ok: true; data: unknown } | { ok: false; message: string };
type Props = {
  call: (method: string, path: string, body?: object) => Promise<Reply>;
  notify: (text: string) => void;
};
type Link = { id: string; name: string; currentChat: string | null; createdAt: string };
type Pairing = { code: string; expiresAt: string };

const time = (iso: string) =>
  new Date(iso).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });

export default function TelegramPage({ call, notify }: Props) {
  const [links, setLinks] = useState<Link[] | null>(null);
  const [ready, setReady] = useState(true);
  const [pairing, setPairing] = useState<Pairing | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const reply = await call('GET', 'links');
    if (!reply.ok) return notify(reply.message);
    const data = reply.data as { ready: boolean; links: Link[] };
    setLinks(data.links);
    setReady(data.ready);
  }, [call, notify]);

  useEffect(() => {
    load();
  }, [load]);

  async function newCode() {
    setBusy(true);
    const reply = await call('POST', 'pairings');
    setBusy(false);
    if (!reply.ok) return notify(reply.message);
    setPairing(reply.data as Pairing);
  }

  async function unlink(link: Link) {
    if (!window.confirm(`${link.name}의 연결을 끊을까요? 그 계정의 말은 더 받지 않아요`)) return;
    const reply = await call('POST', `links/${link.id}/unlink`);
    if (!reply.ok) return notify(reply.message);
    notify('연결을 끊었어요');
    load();
  }

  return (
    <div className="stack">
      <p className="note">
        텔레그램에서 봇에게 쓰면 대표에게 맡겨지고, 답이 텔레그램으로 와요. 승인은 콘솔에서 해요.
        비밀번호 같은 비밀은 보내지 마요 (대화에 남아요)
      </p>
      {!ready && (
        <p className="note">
          설정 › 플러그인 › messenger-telegram에서 봇 토큰과 바깥 주소를 채우고 "웹훅 연결"을 눌러요
        </p>
      )}
      <section className="panel" aria-label="연결 코드">
        <b>계정 잇기</b>
        {pairing ? (
          <>
            <span className="label-mono">{pairing.code}</span>
            <small className="note">
              {time(pairing.expiresAt)}까지 봇에게 이 코드를 보내요. 한 번만 쓸 수 있어요
            </small>
          </>
        ) : (
          <small className="note">코드를 받아 10분 안에 봇에게 보내요</small>
        )}
        <div>
          <button type="button" className="button" disabled={busy || !ready} onClick={newCode}>
            {pairing ? '새 코드' : '연결 코드 받기'}
          </button>
        </div>
      </section>
      {links === null ? (
        <p className="note">불러오는 중</p>
      ) : links.length === 0 ? (
        <p className="note">아직 이어 둔 계정 없음</p>
      ) : (
        <ul className="list" aria-label="이어 둔 계정">
          {links.map((link) => (
            <li key={link.id} className="panel">
              <b>{link.name}</b>
              <small className="note">
                {new Date(link.createdAt).toLocaleDateString('ko-KR')} 연결
                {link.currentChat ? ' · 이어 말하는 대화 있음' : ''}
              </small>
              <div>
                <button type="button" className="text-button" onClick={() => unlink(link)}>
                  연결 끊기
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
