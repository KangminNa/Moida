import { NewTabLink } from '../_ui/NewTabLink';
import { SOURCE_URL } from '../_ui/source';

// 스토어 첫 화면의 Moida 소개 (2026-11-26, 사용자 "스토어 메인 화면과, 거기에 moida의 소개글이 같이 있길"):
// 운영하는 사이트 · 새 소식 아래에 이 사이트를 돌리는 Moida를 소개한다. 제품 설명이라 고정 글이고(회사 소개는 설정의 소개 글),
// 글은 시작 화면 starters/intro와 같은 말을 쓴다. 서버에서 그리고 스크립트가 없다 (자주 묻는 것은 details)

const FLOW = [
  {
    step: '모으기',
    title: '흩어진 AI 작업이 한곳에',
    lines: [
      'Claude Code · Codex 세션이 끝나면 노트와 원문이 와요',
      '웹 AI 대화는 브라우저 확장으로 모아요',
      '읽던 페이지도 보관함에',
    ],
  },
  {
    step: '맡기기',
    title: '대표 하나에게 말하면 일꾼이 나눠 해요',
    lines: [
      '대표가 내 기억과 규칙을 들고 일을 나눠요',
      '코드는 샌드박스 칸에서, 브라우저는 누르기 전에 확인받아요',
      '다른 일꾼이 완료 조건마다 점수를 매겨요',
    ],
  },
  {
    step: '내보내기',
    title: '승인한 것만 사이트로',
    lines: [
      '블로그 · 매거진 · 커뮤니티 · 페이지 앱으로 공개돼요',
      '새 글은 메일 구독자에게 소식으로',
      '공개 · 전송 · 삭제는 관리자가 눌러야 실행돼요',
    ],
  },
] as const;

const FIT = [
  ['기억', '흩어진 AI 대화 · 결정 · 위키가 모여 일마다 함께 가요'],
  ['내 규칙', '스킬 · 지시문을 버전으로 쌓고, 버전마다 성적을 봐요'],
  ['검증', '완료 조건을 먼저 정하고, 다른 일꾼이 점수 4점 넘어야 통과'],
  ['한도', '모델 상한 · 하루 한도 · 대화마다 토큰을 내가 정하고 봐요'],
  ['배움', '내 피드백을 모아 대표가 배우고, 매주 팀을 점검해 제안해요'],
] as const;

const SECURITY = [
  ['비밀번호는 해시로', '되돌릴 수 없는 scrypt 해시만 저장해요'],
  ['키는 암호화', 'API 키 · 토큰은 AES-256-GCM으로 잠가요'],
  ['공개는 승인 뒤', '공개 · 전송 · 삭제는 관리자가 눌러야 실행돼요'],
  ['AI는 칸 안에서', '샌드박스 칸에서 돌고, 허용 목록으로만 나가요'],
  ['앱은 격리', '앱 스크립트는 콘솔에 닿지 못하고, 데이터는 앱마다 나눠요'],
  ['탈퇴하면 바로 지움', '회원 정보 · 구독 주소는 떠나면 바로 지워요'],
] as const;

const RUN = [
  `git clone ${SOURCE_URL}.git moida && cd moida`,
  'docker compose up -d --build',
  'pnpm cairn connect https://내도메인',
] as const;

const NEEDS = ['리눅스 서버 · RAM 2GB', '도메인 하나', '내 AI 구독 연결', 'AGPL-3.0'] as const;

const FAQ = [
  ['AI 비용은?', '서버는 AI를 부르지 않아요. 쓰던 Claude Code · Codex 구독을 연결해요.'],
  [
    'AI가 마음대로 올리진 않나요?',
    '바깥으로 나가는 일은 승인 뒤에만 돼요. 검수 자동 승인은 따로 켜야 하고 기본은 꺼져 있어요.',
  ],
  ['데이터는 어디에?', '내 서버의 Postgres에만 있어요. 백업 zip으로 언제든 옮겨요.'],
  ['지금 써도 되나요?', '정식 배포 전이에요. 보안 검토를 마치면 내놓아요.'],
] as const;

export function StoreIntro() {
  return (
    <section className="store-moida" id="moida" aria-labelledby="store-moida">
      <div className="store-moida-head">
        <p className="store-eyebrow">
          <span className="store-oss">Moida로 운영해요</span>
          Moida = '모이다', 흩어진 것이 한곳에 모여요
        </p>
        <h2 id="store-moida">흩어진 AI 작업을 모아, 사이트로 운영하는 오픈소스</h2>
        <p className="store-lead">
          이 사이트의 글 · 앱은 모두 서버 하나에서 돌아요. AI가 쓰고 만들고, 공개는 사람이 승인해요.
        </p>
      </div>

      <ol className="store-flow" aria-label="흐름">
        {FLOW.map((f, i) => (
          <li key={f.step}>
            <span className="store-glance-no">
              {String(i + 1).padStart(2, '0')} · {f.step}
            </span>
            <strong>{f.title}</strong>
            <ul>
              {f.lines.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          </li>
        ))}
      </ol>

      <div className="store-moida-part">
        <h3>에이전트는 많아도, 대화 상대는 하나</h3>
        <div className="store-compare">
          <div>
            <b>흔한 방식</b>
            <p>
              채팅 AI · 코딩 에이전트 · 브라우저 봇 · 자동화 툴마다 기억 · 규칙 · 권한 · 결과가
              따로라, 사람이 사이를 오가요
            </p>
            <span className="store-meta">창 다섯 개 · 기억 다섯 곳 · 승인은 내 머릿속</span>
          </div>
          <div className="on">
            <b>Moida</b>
            <p>대표 하나와만 이야기하고, 일꾼들은 뒤에서 나눠 일한 뒤 결과 카드 하나로 돌아와요</p>
            <span className="store-meta">창 하나 · 기억 한 곳 · 승인 한 번</span>
          </div>
        </div>
      </div>

      <div className="store-moida-part">
        <h3>모델은 바꿔 끼우고, 나에게 맞춘 것은 남아요</h3>
        <p className="store-desc">
          엔진(Claude Code · Codex)은 러너에서 바꿔 끼우고, 아래 다섯 가지는 내 서버에 남아요
        </p>
        <ul className="store-cards five">
          {FIT.map(([title, text]) => (
            <li key={title}>
              <strong>{title}</strong>
              <span className="store-desc">{text}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="store-moida-part">
        <h3>AI에게 맡겨도 안전하게</h3>
        <ul className="store-cards three">
          {SECURITY.map(([title, text]) => (
            <li key={title}>
              <strong>{title}</strong>
              <span className="store-desc">{text}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="store-moida-part store-run">
        <div>
          <h3>명령 세 줄이면 내 서버에</h3>
          <ul className="store-needs">
            {NEEDS.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
          <NewTabLink className="store-button" href={SOURCE_URL}>
            GitHub에서 소스 보기
          </NewTabLink>
        </div>
        <pre>
          {RUN.map((line) => (
            <span key={line}>
              <span aria-hidden="true">$ </span>
              {line}
              {'\n'}
            </span>
          ))}
        </pre>
      </div>

      <div className="store-moida-part">
        <h3>자주 묻는 것</h3>
        <div className="store-faq">
          {FAQ.map(([q, a]) => (
            <details key={q}>
              <summary>{q}</summary>
              <p>{a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
