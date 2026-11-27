'use client';

import { usePages } from '../../_blog/live';
import { DELIVER_LABELS, DESTINATION_LABELS, TRIGGER_LABELS } from '../../_task/labels';
import type { Schedule } from '../../_task/types';

/** 지킬 것의 길이 (서버 Schedule.RULES_MAX와 같다) */
const RULES_MAX = 2000;

/** 레시피 칸의 값: 어디로 · 페이지 · 받을 것 · 메일로 받기 · 지킬 것 · 계기 · 앞 레시피 (빈 글은 없음) */
export type Recipe = {
  destination: string;
  pageId: string;
  deliver: string;
  mail: boolean;
  rules: string;
  trigger: string;
  afterId: string;
};

/** 스케줄에서 레시피 칸의 처음 값 */
export function recipeOf(schedule: Schedule | null): Recipe {
  return {
    destination: schedule?.destination ?? 'task',
    pageId: schedule?.pageId ?? '',
    deliver: schedule?.deliver ?? '',
    mail: schedule?.mail ?? false,
    rules: schedule?.rules ?? '',
    trigger: schedule?.trigger ?? 'time',
    afterId: schedule?.afterId ?? '',
  };
}

// 자동화 레시피의 칸 (2차 5단계). 그리는 조각이라 값은 폼이 들고, 바뀐 값 한 벌을 onChange로 돌려준다.
// 폼의 순서는 언제(TriggerFields, 주기 위) → 무엇을(지시) → 지킬 것 · 어디로 · 받을 것(RecipeFields).

/** 계기(정한 시각 · 손으로만 · 다른 레시피가 끝난 뒤)와 앞 레시피 */
export function TriggerFields({
  id,
  value,
  others,
  onChange,
}: {
  /** 칸 id의 앞부분 (폼의 useId) */
  id: string;
  value: Recipe;
  /** 앞 레시피로 고를 수 있는 다른 스케줄 */
  others: readonly Schedule[];
  onChange: (next: Recipe) => void;
}) {
  const set = (more: Partial<Recipe>) => onChange({ ...value, ...more });
  return (
    <>
      <div className="field">
        <label htmlFor={`${id}-trigger`}>계기</label>
        <select
          id={`${id}-trigger`}
          className="input"
          value={value.trigger}
          onChange={(e) => set({ trigger: e.target.value, afterId: '' })}
        >
          {Object.entries(TRIGGER_LABELS).map(([key, label]) => (
            <option key={key} value={key} disabled={key === 'after' && others.length === 0}>
              {label}
            </option>
          ))}
        </select>
      </div>
      {value.trigger === 'after' && (
        <div className="field">
          <label htmlFor={`${id}-after`}>앞 레시피</label>
          <select
            id={`${id}-after`}
            className="input"
            value={value.afterId}
            required
            onChange={(e) => set({ afterId: e.target.value })}
          >
            <option value="">고르기</option>
            {others.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title}
              </option>
            ))}
          </select>
          <small>앞 레시피의 일이 끝나면 한 번</small>
        </div>
      )}
    </>
  );
}

/** 지킬 것 · 어디로(작업 · 대화 회차 · 페이지 새 버전) · 페이지 · 받을 것(대화) */
export function RecipeFields({
  id,
  value,
  onChange,
}: {
  /** 칸 id의 앞부분 (폼의 useId) */
  id: string;
  value: Recipe;
  onChange: (next: Recipe) => void;
}) {
  const pages = usePages();
  const set = (more: Partial<Recipe>) => onChange({ ...value, ...more });
  const pageList = pages.data?.pages ?? [];

  return (
    <>
      <div className="field">
        <label htmlFor={`${id}-rules`}>지킬 것</label>
        <textarea
          id={`${id}-rules`}
          className="input"
          rows={2}
          value={value.rules}
          maxLength={RULES_MAX}
          placeholder="예: 표 하나로, 출처 주소를 함께"
          onChange={(e) => set({ rules: e.target.value })}
        />
      </div>
      <div className="field">
        <label htmlFor={`${id}-destination`}>어디로</label>
        <select
          id={`${id}-destination`}
          className="input"
          value={value.destination}
          onChange={(e) =>
            set({ destination: e.target.value, pageId: '', deliver: '', mail: false })
          }
        >
          {Object.entries(DESTINATION_LABELS).map(([key, label]) => (
            <option key={key} value={key} disabled={key === 'page' && pageList.length === 0}>
              {label}
            </option>
          ))}
        </select>
        <small>
          {value.destination === 'chat'
            ? '담당과의 대화에 회차로 쌓임. 결과는 대화의 결과 카드로'
            : value.destination === 'page'
              ? '차례마다 페이지의 새 버전. 담당은 만들기 권한이 있어야 함'
              : '차례마다 작업 하나'}
        </small>
      </div>
      {value.destination === 'page' && (
        <div className="field">
          <label htmlFor={`${id}-page`}>페이지</label>
          <select
            id={`${id}-page`}
            className="input"
            value={value.pageId}
            required
            onChange={(e) => set({ pageId: e.target.value })}
          >
            <option value="">고르기</option>
            {pageList.map((page) => (
              <option key={page.id} value={page.id}>
                {page.title}
              </option>
            ))}
          </select>
        </div>
      )}
      {value.destination === 'chat' && (
        <div className="field">
          <label htmlFor={`${id}-deliver`}>받을 것</label>
          <select
            id={`${id}-deliver`}
            className="input"
            value={value.deliver}
            onChange={(e) => set({ deliver: e.target.value })}
          >
            <option value="">대표가 정함</option>
            {Object.entries(DELIVER_LABELS).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
          <small>결과에 없으면 다시 맡김</small>
        </div>
      )}
      {value.destination === 'chat' && (
        <div className="field">
          <label className="check">
            <input
              type="checkbox"
              checked={value.mail}
              onChange={() => set({ mail: !value.mail })}
            />
            결과를 메일로 받기
          </label>
          <small>차례마다 답이나 실패를 관리자 메일로. 메일 플러그인이 켜져 있어야 함</small>
        </div>
      )}
    </>
  );
}
