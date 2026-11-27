import { useCallback, useEffect, useState } from 'react';

// email의 콘솔 화면 (운영 › 메일 구독, 2026-11-26).
//   보낼 소식: 앱의 글이 공개되면 생긴다. "보내기"를 눌러야 지금 구독 중인 사람들에게 나간다 (원칙 7: 바깥 전송은 사람이 정한다)
//   구독자: 확인을 마친 사람(구독 중)과 확인 메일을 기다리는 사람. 지우면 주소도 바로 지운다
// SMTP · 구독 칸 켜기는 설정 › 플러그인 › email. 화면은 react와 이 폴더만 가져온다 (call · notify는 콘솔이 넘긴다).

type Reply = { ok: true; data: unknown } | { ok: false; message: string };
type Props = {
  call: (method: string, path: string, body?: object) => Promise<Reply>;
  notify: (text: string) => void;
};
type Send = {
  id: string;
  /** news: 가입자 소식 메일 (대화의 결과 카드에서 승인하면 나간다, 2026-11-27) */
  kind: 'post' | 'news';
  appName: string | null;
  title: string;
  link: string | null;
  status: 'draft' | 'ready' | 'sending' | 'done' | 'cancelled';
  total: number;
  sent: number;
  failed: number;
  createdAt: string;
};
type Person = {
  id: string;
  appName: string | null;
  /** 가입 때 소식 메일을 받기로 한 계정 */
  member: boolean;
  address: string;
  status: 'pending' | 'active';
  createdAt: string;
};
/** 메일 사용량 (2026-11-27): 날 · 달은 UTC. 소식 · 구독 메일은 상한의 bulkShare까지만 쓴다 */
type Usage = {
  today: number;
  todayBlocked: number;
  kinds: { kind: string; sent: number; blocked: number }[];
  month: number;
  monthBlocked: number;
  dailyMax: number;
  /** 0이면 한 달 상한 없음 */
  monthlyMax: number;
  bulkShare: number;
  /** 하루 상한 때문에 다음 날을 기다리는 소식 메일 */
  waiting: number;
};
type Overview = {
  ready: boolean;
  open: boolean;
  usage: Usage;
  sends: Send[];
  subscribers: Person[];
};

const STATUS: Record<Send['status'], string> = {
  draft: '승인 기다림',
  ready: '보내기 전',
  sending: '보내는 중',
  done: '보냄',
  cancelled: '취소',
};
const KIND: Record<string, string> = {
  code: '인증코드',
  notice: '알림',
  answer: '자동화 결과',
  test: '테스트',
  confirm: '구독 확인',
  post: '글 소식',
  news: '가입자 소식',
};
const day = (iso: string) => new Date(iso).toLocaleDateString('ko-KR');

/** 오늘 · 이번 달 사용량 막대와 종류별 수. 상한의 80%를 넘으면 브라우저가 경고 색으로 (meter의 high) */
function UsageBox({ usage }: { usage: Usage }) {
  const rows: [string, number, number][] = [['오늘', usage.today, usage.dailyMax]];
  if (usage.monthlyMax > 0) rows.push(['이번 달', usage.month, usage.monthlyMax]);
  const bulk = Math.round(usage.bulkShare * 100);
  return (
    <section aria-label="메일 사용량" className="panel">
      <b>메일 사용량</b>
      {rows.map(([label, used, max]) => (
        <div key={label}>
          <small className="note">
            {label} {used.toLocaleString()} / {max.toLocaleString()}통
          </small>
          <meter
            value={used}
            min={0}
            max={Math.max(max, 1)}
            high={max * 0.8}
            optimum={0}
            aria-label={label}
            style={{ display: 'block', width: '100%' }}
          />
        </div>
      ))}
      {usage.kinds.length > 0 && (
        <small className="note">
          {usage.kinds
            .filter((k) => k.sent + k.blocked > 0)
            .map(
              (k) =>
                `${KIND[k.kind] ?? k.kind} ${k.sent}${k.blocked > 0 ? ` (막힘 ${k.blocked})` : ''}`,
            )
            .join(' · ')}
        </small>
      )}
      {usage.todayBlocked > 0 && (
        <p className="error">오늘 한도에 닿아 {usage.todayBlocked}통을 보내지 않았어요</p>
      )}
      {usage.waiting > 0 && (
        <small className="note">소식 {usage.waiting}통이 한도 때문에 다음 날을 기다려요</small>
      )}
      <small className="note">
        구독 · 소식 메일은 상한의 {bulk}%까지만 써요. 남은 몫은 인증코드 · 알림용. 상한은 설정 ›
        플러그인 › email (날짜 기준 UTC)
      </small>
    </section>
  );
}

export default function MailPage({ call, notify }: Props) {
  const [data, setData] = useState<Overview | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const reply = await call('GET', 'overview');
    if (!reply.ok) return notify(reply.message);
    setData(reply.data as Overview);
  }, [call, notify]);

  useEffect(() => {
    load();
    const timer = setInterval(load, 15_000);
    return () => clearInterval(timer);
  }, [load]);

  async function act(key: string, path: string, done: string, ask?: string) {
    if (ask && !window.confirm(ask)) return;
    setBusy(key);
    const reply = await call('POST', path);
    setBusy(null);
    if (!reply.ok) return notify(reply.message);
    notify(done);
    load();
  }

  if (!data) return <p className="note">불러오는 중</p>;
  const active = data.subscribers.filter((s) => s.status === 'active').length;
  return (
    <div className="stack">
      {!data.ready && (
        <p className="note">
          설정 › 플러그인 › email에서 보내는 계정 · 앱 비밀번호 · 바깥 주소를 채우고 테스트 메일을
          보내 봐요
        </p>
      )}
      {data.ready && !data.open && (
        <p className="note">
          스토어의 구독 칸이 꺼져 있어요. 설정 › 플러그인 › email의 "스토어에 구독 칸 보이기"를 켜요
        </p>
      )}
      <p className="note">구독 중 {active}명</p>
      <UsageBox usage={data.usage} />
      <section aria-label="새 글 소식">
        <b>새 글 소식</b>
        {data.sends.length === 0 ? (
          <p className="note">구독자가 있는 앱에 글이 공개되면 여기에 생겨요</p>
        ) : (
          <ul className="list">
            {data.sends.map((s) => (
              <li key={s.id} className="panel">
                <b>
                  [{s.kind === 'news' ? '가입자 소식' : s.appName}] {s.title}
                </b>
                <small className="note">
                  {STATUS[s.status]} · {day(s.createdAt)} ·{' '}
                  {s.status === 'draft'
                    ? `가입자 ${s.total}명 · 대화의 결과 카드에서 승인하면 나가요`
                    : s.status === 'ready'
                      ? `구독자 ${s.total}명에게 보낼 수 있어요`
                      : `${s.sent}/${s.total}통 보냄`}
                  {s.failed > 0 ? ` · 실패 ${s.failed}` : ''}
                </small>
                {(s.status === 'ready' || s.status === 'sending') && (
                  <div>
                    {s.status === 'ready' && (
                      <button
                        type="button"
                        className="button"
                        disabled={busy !== null || !data.ready || s.total === 0}
                        onClick={() =>
                          act(
                            `start:${s.id}`,
                            `sends/${s.id}/start`,
                            '보내기 시작했어요',
                            `구독자 ${s.total}명에게 "${s.title}" 소식을 보낼까요? 보낸 메일은 되돌릴 수 없어요`,
                          )
                        }
                      >
                        보내기
                      </button>
                    )}
                    <button
                      type="button"
                      className="text-button"
                      disabled={busy !== null}
                      onClick={() =>
                        act(
                          `cancel:${s.id}`,
                          `sends/${s.id}/cancel`,
                          '취소했어요',
                          '이 소식을 보내지 않을까요? 이미 간 메일은 그대로예요',
                        )
                      }
                    >
                      {s.status === 'ready' ? '보내지 않기' : '남은 것 멈추기'}
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-label="구독자">
        <b>구독자</b>
        {data.subscribers.length === 0 ? (
          <p className="note">아직 구독자 없음</p>
        ) : (
          <ul className="list">
            {data.subscribers.map((p) => (
              <li key={p.id} className="panel">
                <b>{p.address}</b>
                <small className="note">
                  {p.member ? '가입자 · 소식 메일 동의' : p.appName} ·{' '}
                  {p.status === 'active' ? '구독 중' : '확인 메일 기다림'} · {day(p.createdAt)}
                </small>
                <div>
                  <button
                    type="button"
                    className="text-button"
                    disabled={busy !== null}
                    onClick={() =>
                      act(
                        `remove:${p.id}`,
                        `subscribers/${p.id}/remove`,
                        '지웠어요',
                        `${p.address}의 ${p.appName} 구독을 지울까요? 주소도 바로 지워요`,
                      )
                    }
                  >
                    삭제
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
