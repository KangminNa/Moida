import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { Task } from '../task/task';
import { ChatResult } from './chat-result.policy';
import { ChatReview } from './chat-review.policy';

// 검증 고리 V: 검토자 짝의 판정 읽기와, 판정에 따른 회차의 다음 할 일 (횟수 한도)

const verdict = (more: Record<string, unknown>) =>
  JSON.stringify({ verdict: 'fix', summary: '근거가 약해요', ...more });

describe('ChatReview.parse', () => {
  test('JSON 판정: 앞뒤 글이 붙어도 읽고, 빈 줄 · 넘치는 줄 · 긴 글은 자른다', () => {
    const review = ChatReview.parse(
      `검토했어요.\n${verdict({
        checklist: [
          { item: '출처 링크', ok: false, note: '없음' },
          { item: '', ok: true },
          { item: '표 포함', ok: 'yes' },
        ],
        fixes: ['출처 링크를 단다', '', 'x'.repeat(500)],
        skip: ['초안.html'],
      })}\n끝`,
    );
    assert.equal(review.verdict, 'fix');
    assert.equal(review.summary, '근거가 약해요');
    assert.deepEqual(review.checklist, [
      { item: '출처 링크', ok: false, note: '없음', score: null },
      { item: '표 포함', ok: false, note: '', score: null },
    ]);
    assert.deepEqual([review.score, ChatReview.lowOf(review)], [null, null], '점수가 없으면 null');
    assert.deepEqual(review.fixes, ['출처 링크를 단다', 'x'.repeat(300)]);
    assert.deepEqual(review.skip, ['초안.html']);
  });

  test('JSON이 아니거나 모르는 판정이면 unknown과 글 그대로 (자동으로 고치지 않는다)', () => {
    for (const text of ['그대로 승인. 근거가 충분해요', verdict({ verdict: 'maybe' }), '{ 깨짐']) {
      const review = ChatReview.parse(text);
      assert.equal(review.verdict, ChatReview.UNKNOWN);
      assert.equal(review.summary, text);
      assert.equal(ChatReview.wantsFix(review), false);
    }
  });

  test('다시 맡기는 판정은 fix이고 고칠 것이 있을 때만. 소식 한 줄 · 틀의 자리', () => {
    assert.equal(ChatReview.wantsFix(ChatReview.parse(verdict({ fixes: ['고친다'] }))), true);
    assert.equal(ChatReview.wantsFix(ChatReview.parse(verdict({ fixes: [] }))), false);
    const reject = ChatReview.parse(verdict({ verdict: 'reject', fixes: ['고친다'] }));
    assert.equal(ChatReview.wantsFix(reject), false);
    assert.equal(ChatReview.line(reject), '반려 권함 · 근거가 약해요');
    const fix = ChatReview.parse(
      verdict({ fixes: ['링크를 단다'], checklist: [{ item: '출처', ok: false, note: '없음' }] }),
    );
    assert.deepEqual(ChatReview.fixFields(fix), {
      summary: '근거가 약해요',
      fixes: '- 링크를 단다',
      unmet: '- 출처 (없음)',
    });
  });
});

describe('점수로 판정 (2026-11-20)', () => {
  const scored = (verdict: string, scores: unknown[], fixes: string[] = []) =>
    ChatReview.parse(
      JSON.stringify({
        verdict,
        summary: '봤어요',
        checklist: scores.map((score, i) => ({
          item: `조건 ${i + 1}`,
          score,
          ok: true,
          note: `까닭 ${i + 1}`,
        })),
        fixes,
      }),
    );

  test('조건마다 1~5점(소수는 반올림, 범위 밖은 끝으로): 4점 이상만 채운 조건이고 평균 · 가장 낮은 점수를 남긴다', () => {
    const review = scored('pass', [5, 4.4, 9]);
    assert.deepEqual(
      review.checklist.map((l) => [l.score, l.ok]),
      [
        [5, true],
        [4, true],
        [5, true],
      ],
    );
    assert.deepEqual([review.verdict, review.score, ChatReview.lowOf(review)], ['pass', 4.67, 4]);
    assert.equal(ChatReview.line(review), '그대로 승인 (평균 4.67점) · 봤어요');
  });

  test('4점 아래 조건이 있는 통과는 서버가 고칠 것으로 바꾼다: 고칠 것이 없으면 낮은 조건과 까닭으로', () => {
    const review = scored('pass', [5, 3, 2]);
    assert.equal(review.verdict, ChatReview.FIX);
    assert.match(review.summary, /4점 아래 조건이 있어 고칠 것으로 봄/);
    assert.deepEqual(review.fixes, ['조건 2: 까닭 2', '조건 3: 까닭 3']);
    assert.equal(ChatReview.wantsFix(review), true);
    assert.deepEqual(
      scored('pass', [3], ['제목을 고친다']).fixes,
      ['제목을 고친다'],
      '적은 고칠 것이 먼저',
    );
    assert.equal(scored('reject', [1]).verdict, ChatReview.REJECT, '반려는 그대로');
    assert.equal(
      ChatReview.fixFields(review).unmet,
      '- 조건 2 3점 (까닭 2)\n- 조건 3 2점 (까닭 3)',
    );
  });

  test('점수가 없는 조건은 지금처럼 ok를 따른다 (콘솔에서 고친 옛 틀)', () => {
    const review = ChatReview.parse(
      JSON.stringify({ verdict: 'pass', checklist: [{ item: '옛 조건', ok: true }] }),
    );
    assert.deepEqual([review.verdict, review.checklist[0]?.ok, review.score], ['pass', true, null]);
  });
});

describe('ChatResult.next (검증 고리)', () => {
  const fix = ChatReview.parse(verdict({ fixes: ['고친다'] }));
  const pass = ChatReview.parse(JSON.stringify({ verdict: 'pass', summary: '좋아요' }));

  test('검토가 고칠 것을 남기면 한 번 다시 맡기고, 그다음은 판정 그대로 카드', () => {
    assert.equal(
      ChatResult.next({
        root: Task.DONE,
        items: 1,
        missing: false,
        carded: false,
        fixes: 0,
        reviewFixes: 0,
        reviewer: true,
        reviewed: true,
        review: fix,
      }),
      ChatResult.REVIEW_FIX,
    );
    assert.equal(
      ChatResult.next({
        root: Task.DONE,
        items: 1,
        missing: false,
        carded: false,
        fixes: 1,
        reviewFixes: 1,
        reviewer: true,
        reviewed: true,
        review: fix,
      }),
      ChatResult.CARD,
    );
    assert.equal(
      ChatResult.next({
        root: Task.DONE,
        items: 1,
        missing: false,
        carded: false,
        fixes: 0,
        reviewFixes: 0,
        reviewer: true,
        reviewed: true,
        review: pass,
      }),
      ChatResult.CARD,
    );
  });

  test('결재만 기다리는 회차도 검토하지만, 고칠 것이 나와도 다시 맡기지 않는다 (회차가 끝나지 않았다)', () => {
    assert.equal(
      ChatResult.next({
        root: Task.WAITING,
        items: 1,
        missing: false,
        carded: false,
        fixes: 0,
        reviewFixes: 0,
        reviewer: true,
        reviewed: false,
        review: null,
      }),
      ChatResult.REVIEW,
    );
    assert.equal(
      ChatResult.next({
        root: Task.WAITING,
        items: 1,
        missing: false,
        carded: false,
        fixes: 0,
        reviewFixes: 0,
        reviewer: true,
        reviewed: true,
        review: fix,
      }),
      ChatResult.CARD,
    );
  });

  test('다시 맡긴 회차 세기: 이어진 것만, 까닭을 주면 그 까닭만', () => {
    const turn = (chat: Record<string, unknown> | null) => ({ payload: chat ? { chat } : null });
    const previous = [
      turn({ fix: true, fixBy: 'review' }),
      turn(null),
      turn({ fix: true }),
      turn({ fix: true, fixBy: 'review' }),
    ];
    assert.equal(ChatResult.fixesIn(previous), 2);
    assert.equal(ChatResult.fixesIn(previous, ChatResult.BY_REVIEW), 1);
  });

  test('이미 카드에 실린 회차는 받을 것이 빠져 보여도 다시 맡기지 않는다', () => {
    const turn = {
      root: Task.DONE,
      items: 0,
      missing: true,
      fixes: 0,
      reviewFixes: 0,
      reviewer: false,
      reviewed: false,
      review: null,
    };
    assert.equal(ChatResult.next({ ...turn, carded: false }), ChatResult.FIX);
    assert.equal(ChatResult.next({ ...turn, carded: true }), ChatResult.NONE);
  });

  test('바뀐 결과물: 같은 이름(대소문자 무시)이면 마지막 것만 남긴다', () => {
    const made = [
      { id: '1', name: 'index.html' },
      { id: '2', name: '표.csv' },
      { id: '3', name: 'INDEX.html' },
    ];
    assert.deepEqual(
      ChatResult.superseded(made).map((o) => o.id),
      ['1'],
    );
  });
});
