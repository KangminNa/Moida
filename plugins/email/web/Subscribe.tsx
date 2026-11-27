'use client';

import { type FormEvent, useState } from 'react';

// 스토어 첫 화면 아래(store.after)의 "새 글을 메일로 받기" (2026-11-26, 플러그인 email).
//   구독: 앱 고르기 · 주소 · 동의 → 확인 메일 (두 번 확인). 주소가 이미 있는지는 답이 같아 드러나지 않는다
//   메일 링크로 왔을 때(?mail=confirm|unsubscribe&token=…): 확인 · 해지 단추 (링크를 여는 것만으로는 바뀌지 않는다: 메일 보안 검사기가 링크를 미리 열어도 그대로)
// 화면은 react와 이 폴더만 가져온다. 서버는 같은 출처의 /api/p/email/…

type App = { slug: string; name: string };
type Props = {
  settings: Record<string, string>;
  context: { apps: readonly App[]; mail: string | null; token: string | null };
};

async function post(
  path: string,
  body: object,
): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  try {
    const res = await fetch(`/api/p/email/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { ok: res.ok, data };
  } catch {
    return { ok: false, data: { message: '서버에 닿지 못했어요' } };
  }
}

const said = (data: Record<string, unknown>) =>
  typeof data.message === 'string' ? data.message : '못 했어요';

export default function Subscribe({ settings, context }: Props) {
  const apps = context.apps;
  const link = context.mail === 'confirm' || context.mail === 'unsubscribe' ? context.mail : null;
  return (
    <>
      {link && context.token && <MailLink action={link} token={context.token} />}
      {settings.subscriptions === 'true' && apps.length > 0 && <SubscribeForm apps={apps} />}
    </>
  );
}

function MailLink({ action, token }: { action: 'confirm' | 'unsubscribe'; token: string }) {
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);
  const confirm = action === 'confirm';

  async function go() {
    setBusy(true);
    const { ok, data } = await post(`${action}/${token}`, {});
    setBusy(false);
    const apps = Array.isArray(data.apps) ? (data.apps as string[]).join(', ') : '';
    if (!ok) return setAnswer(said(data));
    if (confirm)
      return setAnswer(
        `구독했어요${apps ? ` · ${apps}` : ''}. 새 글이 올라오면 메일로 알려 드려요`,
      );
    setAnswer(apps ? `해지했어요 · ${apps}. 메일 주소도 지웠어요` : '이미 해지된 구독이에요');
  }

  return (
    <section className="store-section store-mail-link" aria-live="polite">
      <h2>{confirm ? '구독 확인' : '구독 해지'}</h2>
      {answer ? (
        <p>{answer}</p>
      ) : (
        <>
          <p className="store-desc">
            {confirm
              ? '아래 단추를 누르면 새 글 소식 메일을 받기 시작해요.'
              : '아래 단추를 누르면 새 글 소식 메일을 그만 받고 메일 주소를 바로 지워요.'}
          </p>
          <button type="button" className="store-open cta" disabled={busy} onClick={go}>
            {confirm ? '구독 확인' : '구독 해지'}
          </button>
        </>
      )}
    </section>
  );
}

function SubscribeForm({ apps }: { apps: readonly App[] }) {
  const [picked, setPicked] = useState<readonly string[]>(
    apps.length === 1 ? [apps[0]?.slug ?? ''] : [],
  );
  const [address, setAddress] = useState('');
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<{ ok: boolean; text: string } | null>(null);

  const toggle = (slug: string) =>
    setPicked((now) => (now.includes(slug) ? now.filter((p) => p !== slug) : [...now, slug]));

  async function submit(event: FormEvent) {
    event.preventDefault();
    // 버튼을 막아 두지 않고 무엇이 빠졌는지 말한다 (2026-11-27: 동의 칸을 못 보고 눌러도 반응이 없던 것)
    if (picked.length === 0) return setAnswer({ ok: false, text: '받을 앱을 골라 주세요' });
    if (!agree) return setAnswer({ ok: false, text: '아래 동의 칸에 체크해 주세요' });
    setBusy(true);
    const { ok, data } = await post('subscribe', { apps: picked, address, agree });
    setBusy(false);
    setAnswer(
      ok
        ? { ok, text: `${address}로 확인 메일을 보냈어요. 메일의 링크를 눌러야 구독이 시작돼요` }
        : { ok, text: said(data) },
    );
  }

  return (
    <section className="store-section store-subscribe" aria-labelledby="store-subscribe">
      <h2 id="store-subscribe">새 글을 메일로 받기</h2>
      <form onSubmit={submit}>
        {apps.length > 1 && (
          <fieldset className="store-chips">
            <legend>받을 앱</legend>
            {apps.map((a) => (
              <label key={a.slug} className={picked.includes(a.slug) ? 'on' : ''}>
                <input
                  type="checkbox"
                  checked={picked.includes(a.slug)}
                  onChange={() => toggle(a.slug)}
                />
                {a.name}
              </label>
            ))}
          </fieldset>
        )}
        <div className="store-subscribe-row">
          <input
            type="email"
            required
            autoComplete="email"
            maxLength={254}
            placeholder="메일 주소"
            aria-label="메일 주소"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
          />
          <button type="submit" className="store-open cta" disabled={busy}>
            구독
          </button>
        </div>
        <label className="store-agree">
          <input
            type="checkbox"
            checked={agree}
            onChange={(e) => {
              setAgree(e.target.checked);
              setAnswer(null);
            }}
          />
          <span>
            메일 주소를 고른 앱의 새 글 소식을 보내는 데만 쓰는 것에 동의해요. 메일마다 해지 링크가
            있고, 해지하면 주소를 바로 지워요. 확인하지 않은 신청은 7일 뒤 지워져요
          </span>
        </label>
        {answer && <p className={answer.ok ? 'store-desc' : 'store-error'}>{answer.text}</p>}
      </form>
    </section>
  );
}
