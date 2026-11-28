// 메일 보내기 하나 (플러그인 API 0.14, 2026-11-26): 메일 플러그인이 하위 클래스를 만들어 `moida.provideMail(…)`로 등록한다.
// 코어(회원 가입 · 비밀번호 다시 정하기)는 PluginRegistry.mailer()로 이것을 받아 인증코드 메일을 보낸다.
// 코어가 메일 회사 · SMTP를 모르게 하려는 자리다: 보내는 길은 플러그인이, 무엇을 언제 보낼지는 코어가 정한다.
// 인증코드는 이벤트(outbox)로 넘기지 않는다: DB에 코드 원문이 남지 않게 메모리에서 바로 보낸다.
export abstract class BaseMailer {
  /** 한 통을 보낸다. 실패하면 오류를 던진다 (코어가 로그에 남기고 화면에는 같은 답을 준다) */
  abstract send(to: string, subject: string, text: string): Promise<void>;
}
