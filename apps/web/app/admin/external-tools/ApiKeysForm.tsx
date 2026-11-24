'use client';

import { type FormEvent, useState } from 'react';
import type { ApiConnector } from '../../_task/types';

/** 키 하나의 길이 (서버 ApiConnector.SECRET_MAX와 같다) */
const KEY_MAX = 4000;

// API 커넥터의 키 넣기 (2026-11-24): 정의서가 적은 머리글마다 칸 하나. 넣은 칸만 보낸다 (빈 칸은 그대로 둔다).
// 값은 서버가 잠그고 다시 보이지 않는다. 저장은 패널이 돌린다
export function ApiKeysForm({
  connector,
  busy,
  problem,
  onSubmit,
  onEdit,
}: {
  connector: ApiConnector;
  busy: boolean;
  problem: string | null;
  onSubmit: (keys: Record<string, string>) => Promise<boolean>;
  onEdit: () => void;
}) {
  const [values, setValues] = useState<Readonly<Record<string, string>>>({});

  async function submit(event: FormEvent) {
    event.preventDefault();
    const keys = Object.fromEntries(Object.entries(values).filter(([, v]) => v !== ''));
    if (Object.keys(keys).length > 0 && (await onSubmit(keys))) setValues({});
  }

  return (
    <form className="stack" onSubmit={submit}>
      {connector.keys.map((k) => (
        <label key={k.name} className="field">
          <span>
            {k.name} {k.set ? '(넣음, 바꾸려면 새 값)' : ''}
          </span>
          <input
            className="input"
            type="password"
            autoComplete="off"
            maxLength={KEY_MAX}
            value={values[k.name] ?? ''}
            onChange={(e) => {
              onEdit();
              setValues({ ...values, [k.name]: e.target.value });
            }}
          />
        </label>
      ))}
      {problem && <p className="error">{problem}</p>}
      <div className="row">
        <button type="submit" className="cta small" disabled={busy}>
          키 저장
        </button>
      </div>
    </form>
  );
}
