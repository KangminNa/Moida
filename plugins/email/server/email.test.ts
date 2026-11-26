import assert from 'node:assert/strict';
import { connect } from 'node:net';
import { after, before, describe, test } from 'node:test';
import { DomainEvent, RuleViolation } from '../../../apps/server/src/plugin-api';
import { FakeSmtp } from './fake-smtp';
import { MailMessage } from './mail-message';
import { NoticeMail } from './notice-mail';
import { NoticeSentHandler } from './notice-sent.handler';
import { SmtpGateway } from './smtp.gateway';

// 알림 메일 (2026-11-26): 메일 한 통의 모양 · SMTP 주고받기 · 알림 이벤트에서 메일로
const USER = 'me@gmail.example';
const PASSWORD = 'abcd efgh ijkl mnop';
let smtp: FakeSmtp;
const plain = (host: string, port: number) => connect({ host, port });
const gateway = (password = PASSWORD) =>
  new SmtpGateway('127.0.0.1', smtp.port, USER, password, () => plain('127.0.0.1', smtp.port));
const settings = (values: Record<string, string>) => ({ get: (k: string) => values[k] });
const mail = NoticeMail.of(
  settings({ user: USER, to: 'admin@mail.example', siteUrl: 'https://cairn.example/' }),
) as NoticeMail;

/** DATA 원문에서 머리글 하나 (접힌 줄은 이어 붙인다) */
function header(data: string, name: string): string {
  const unfolded = data.replace(/\r\n /g, ' ');
  return (
    unfolded
      .split('\r\n')
      .find((l) => l.startsWith(`${name}: `))
      ?.slice(name.length + 2) ?? ''
  );
}
/** encoded-word를 풀어 원래 글로 */
function decode(value: string): string {
  return value
    .split(' ')
    .map((w) => Buffer.from(w.replace(/^=\?UTF-8\?B\?|\?=$/g, ''), 'base64').toString())
    .join('');
}
function body(data: string): string {
  const [, rest = ''] = data.split('\r\n\r\n');
  return Buffer.from(rest.replace(/\r\n/g, ''), 'base64').toString();
}

before(async () => {
  smtp = await FakeSmtp.start(USER, PASSWORD);
});
after(() => smtp.close());

describe('MailMessage', () => {
  test('긴 한국어 제목은 75자 이하 encoded-word 여러 개로 접고, 풀면 그대로다', () => {
    const subject =
      '[Moida] 승인 요청: 매거진 3호 발행을 기다려요 · 표지와 목차를 확인해 주세요'.repeat(2);
    const data = new MailMessage(USER, 'admin@mail.example', subject, '본문').render(
      'Moida',
      new Date(0),
    );
    const raw = data.split('\r\n\r\n')[0] ?? '';
    for (const word of raw.match(/=\?UTF-8\?B\?[^?]*\?=/g) ?? [])
      assert.ok(word.length <= 75, word);
    assert.equal(decode(header(data, 'Subject')), subject);
    assert.match(header(data, 'From'), /<me@gmail\.example>$/);
  });

  test('줄바꿈으로 머리글을 끼워 넣지 못한다 (주소는 거절, 제목은 한 줄로)', () => {
    assert.throws(
      () => new MailMessage(USER, 'a@b.example\r\nBcc: x@y.example', '제목', '본문'),
      RuleViolation,
    );
    const data = new MailMessage(USER, 'a@b.example', '제목\r\nBcc: x@y.example', '본문').render(
      'Moida',
      new Date(0),
    );
    assert.equal(header(data, 'Bcc'), '');
    assert.equal(decode(header(data, 'Subject')), '제목 Bcc: x@y.example');
  });
});

describe('SmtpGateway', () => {
  test('로그인하고 한 통 보낸다: 받는 주소 · 제목 · 본문의 콘솔 링크', async () => {
    await gateway().send(
      mail.notice('승인 요청: 글 공개', '비공개 내용', '/admin/approvals'),
      'Moida',
      new Date(),
    );
    const sent = smtp.mails.at(-1);
    assert.ok(sent);
    assert.equal(sent.from, USER);
    assert.equal(sent.to, 'admin@mail.example');
    assert.equal(decode(header(sent.data, 'Subject')), '[Moida] 승인 요청: 글 공개');
    const text = body(sent.data);
    assert.match(text, /https:\/\/cairn\.example\/admin\/approvals/);
    assert.doesNotMatch(text, /비공개 내용/, '본문 싣기를 켜지 않으면 제목 · 링크만');
    assert.deepEqual(smtp.commands.slice(-6), [
      'EHLO cairn',
      'AUTH',
      `MAIL FROM:<${USER}>`,
      'RCPT TO:<admin@mail.example>',
      'DATA',
      'QUIT',
    ]);
  });

  test('로그인 거절(535)은 앱 비밀번호를 알려 주고, 비밀번호를 오류 글에 싣지 않는다', async () => {
    const before = smtp.mails.length;
    await assert.rejects(
      gateway('wrong-password').send(mail.test(), 'Moida', new Date()),
      (e: Error) => {
        assert.match(e.message, /앱 비밀번호/);
        assert.doesNotMatch(e.message, /wrong-password/);
        return true;
      },
    );
    assert.equal(smtp.mails.length, before);
  });

  test('받는 사람을 거절하면 메일 서버의 번호와 글로 실패한다', async () => {
    const blocked = new NoticeMail(USER, 'nobody@blocked.example', 'https://cairn.example', false);
    await assert.rejects(gateway().send(blocked.test(), 'Moida', new Date()), /550/);
  });
});

describe('NoticeMail · NoticeSentHandler', () => {
  test('설정이 틀리면 보내지 않는다 (주소 모양 · 바깥 주소)', () => {
    assert.equal(NoticeMail.of(settings({ user: 'not-mail', siteUrl: 'https://a.example' })), null);
    assert.equal(NoticeMail.of(settings({ user: USER, siteUrl: 'ftp://a.example' })), null);
    assert.equal(NoticeMail.of(settings({ user: USER, siteUrl: 'https://a.example' }))?.to, USER);
  });

  test('링크는 이 Moida 안의 경로만, 본문은 켰을 때만', () => {
    const outside = body(mail.notice('제목', '', '//evil.example/x').render('Moida', new Date()));
    assert.match(outside, /https:\/\/cairn\.example\/admin\r\n/);
    const detailed = new NoticeMail(USER, USER, 'https://cairn.example', true);
    assert.match(
      body(detailed.notice('제목', '자세한 글', '/admin').render('Moida', new Date())),
      /자세한 글/,
    );
  });

  test('알림 이벤트 하나에 메일 한 통, 다른 이벤트 · 설정 없음은 건너뛴다', async () => {
    const before = smtp.mails.length;
    const event = (name: string) =>
      new DomainEvent(name, 1, '00000000-0000-7000-8000-000000000001', {
        title: '작업 실패',
        body: '',
        link: '/admin/tasks',
        tag: 'x',
      });
    await new NoticeSentHandler(gateway(), mail).handle(event(NoticeSentHandler.TOPIC));
    await new NoticeSentHandler(gateway(), mail).handle(event('platform.plugin.changed'));
    await new NoticeSentHandler(null, null).handle(event(NoticeSentHandler.TOPIC));
    assert.equal(smtp.mails.length, before + 1);
    assert.equal(decode(header(smtp.mails.at(-1)?.data ?? '', 'Subject')), '[Moida] 작업 실패');
  });
});
