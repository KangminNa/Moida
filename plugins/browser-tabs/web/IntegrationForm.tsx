import { type FormEvent, useEffect, useState } from 'react';
import type { Call, Site } from './browser-types';

// 도구로 만들기 (2026-11-16 MCP 2단계): 사이트에서 되풀이하는 읽기 일을 코드로 굳혀 달라고 맡긴다.
// 힌트에는 앞선 브라우저 일의 지시와 답을 적는다. 그 사이트에서 끝난 브라우저 일을 고르면 채워 준다 (코어의 작업 읽기)

type Finished = {
  id: string;
  title: string;
  kind: string;
  target: { kind: string; id: string } | null;
};
type TaskDetail = { instruction: string; result: { text?: unknown } | null };

const NAME = /^[a-z][a-z0-9_]{1,39}$/;

export function IntegrationForm({
  call,
  notify,
  onMade,
}: {
  call: Call;
  notify: (text: string) => void;
  onMade: () => void;
}) {
  const [sites, setSites] = useState<Site[]>([]);
  const [tasks, setTasks] = useState<Finished[]>([]);
  const [siteId, setSiteId] = useState('');
  const [name, setName] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [hint, setHint] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    call('GET', 'sites').then((reply) => {
      if (reply.ok) setSites((reply.data as { sites: Site[] }).sites);
    });
    call('GET', '/api/tasks?status=done').then((reply) => {
      if (reply.ok) setTasks((reply.data as { tasks: Finished[] }).tasks);
    });
  }, [call]);

  const fromSite = tasks.filter(
    (t) => t.kind === 'browse' && t.target?.kind === 'browser_site' && t.target.id === siteId,
  );

  async function fill(taskId: string) {
    if (!taskId) return;
    const reply = await call('GET', `/api/tasks/${taskId}`);
    if (!reply.ok) return notify(reply.message);
    const task = reply.data as TaskDetail;
    const answer = typeof task.result?.text === 'string' ? task.result.text : '';
    setHint(`지시: ${task.instruction}\n\n답: ${answer}`.slice(0, 4000));
  }

  async function make(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    const reply = await call('POST', 'integrations', {
      requestId: crypto.randomUUID(),
      siteId,
      name,
      title,
      description,
      hint,
    });
    setBusy(false);
    if (!reply.ok) return notify(reply.message);
    setName('');
    setTitle('');
    setDescription('');
    setHint('');
    notify('도구 만들기를 맡겼어요. 시험을 통과하면 승인 요청이 와요');
    onMade();
  }

  return (
    <form className="panel" onSubmit={make} aria-label="도구 만들기">
      <b>도구 만들기</b>
      <label className="field">
        <span>사이트</span>
        <select required value={siteId} onChange={(e) => setSiteId(e.target.value)}>
          <option value="">고르기</option>
          {sites.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      {fromSite.length > 0 && (
        <label className="field">
          <span>앞선 브라우저 일에서 힌트 가져오기</span>
          <select defaultValue="" onChange={(e) => fill(e.target.value)}>
            <option value="">고르기</option>
            {fromSite.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="field">
        <span>이름 (에이전트가 부르는 이름: 소문자 · 숫자 · _)</span>
        <input
          required
          maxLength={40}
          value={name}
          placeholder="stock_close"
          onChange={(e) => setName(e.target.value.toLowerCase())}
        />
      </label>
      <label className="field">
        <span>제목</span>
        <input required maxLength={60} value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label className="field">
        <span>설명 (에이전트가 고를 때 읽어요)</span>
        <input
          required
          maxLength={300}
          value={description}
          placeholder="종목 코드로 오늘 종가와 등락률을 읽는다"
          onChange={(e) => setDescription(e.target.value)}
        />
      </label>
      <label className="field">
        <span>힌트 (앞선 일의 지시 · 답, 읽을 화면)</span>
        <textarea
          rows={4}
          maxLength={4000}
          value={hint}
          onChange={(e) => setHint(e.target.value)}
        />
      </label>
      <p className="note">
        브라우저 담당이 사이트를 둘러보며 읽기만 하는 코드를 쓰고, 러너가 시험해 70% 이상 통과하면
        켜기 승인이 와요
      </p>
      <button
        type="submit"
        className="cta small fit"
        disabled={busy || !siteId || !NAME.test(name) || !title || !description}
      >
        만들기 맡기기
      </button>
    </form>
  );
}
