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
      { item: '출처 링크', ok: false, note: '없음' },
      { item: '표 포함', ok: false, note: '' },
    ]);
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
