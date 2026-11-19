import { Actor } from '../../platform';
import type { AgentTeamRow } from './agent.view';

// 팀 템플릿 가운데 만들기 · 데이터 · 코드 · 정리 계열 (AgentTeams가 모은다, 글 · 앱 운영은 writing-teams.ts). 구성원은 보고 대상이 앞에 오게 적는다.
// 만들기(make) · 코드(code)는 전체 읽기 · 쓰기와 한 에이전트에 두지 않는다 (Agent 규칙).
export const WORK_TEAMS: readonly AgentTeamRow[] = [
  {
    key: 'output',
    title: '결과물 제작 팀',
    description:
      '요청 하나로 보고서 · 발표 자료 · 표/차트 · 웹 페이지를 모두 HTML로 만든다(콘솔에서 바로 열기). 결과물 팀장이 내용을 정리해 형식별 제작자에게 나눠 맡기고, 나온 파일을 모아 보고한다',
    needs: ['code-runner'],
    members: [
      {
        key: 'lead',
        reports_to: null,
        name: '결과물 팀장',
        scopes: [Actor.READ_PUBLIC],
        approval_actions: [],
        role: [
          '결과물 제작 팀의 팀장.',
          '- 요청을 받으면 무엇을 어떤 형식으로 낼지 정한다: 목차 · 핵심 메시지 · 들어갈 숫자 · 출처.',
          '- 근거가 모자라면 먼저 자료 정리에게 맡기고, 내용이 서면 형식별 제작자에게 kind: make로 나눠 맡긴다.',
          '- 제작자는 재료 없이 지시만 받는다: 본문 · 표 데이터 · 출처를 지시에 빠짐없이 적는다.',
          '- 하위 작업 결과의 결과물(output_id)을 모아 무엇이 나왔는지 정리한다. 목표 실행이면 report_round의 근거에 건다.',
        ].join('\n'),
      },
      {
        key: 'research',
        reports_to: 'lead',
        name: '자료 정리',
        scopes: [Actor.READ_PUBLIC],
        approval_actions: [],
        role: [
          '결과물 팀의 자료 정리.',
          '- 결과물에 들어갈 사실 · 수치 · 인용을 웹 검색과 read_url로 찾아 출처 주소와 함께 표로 정리한다.',
          '- 제작자에게 그대로 넘길 수 있게 항목 · 값 · 단위 · 기준일 · 출처로 쓴다.',
        ].join('\n'),
      },
      {
        key: 'doc',
        reports_to: 'lead',
        name: '문서 제작자',
        scopes: [Actor.MAKE],
        approval_actions: [],
        role: [
          '결과물 팀의 문서 제작자 (만들기 작업, 샌드박스).',
          '- 보고서 · 기획서를 HTML 문서 하나로 만든다 (인쇄하면 A4 PDF). 제목 → 요약 → 본문 → 출처 순서. .docx는 지시에 워드라고 적혀 있을 때만.',
        ].join('\n'),
      },
      {
        key: 'slides',
        reports_to: 'lead',
        name: '슬라이드 제작자',
        scopes: [Actor.MAKE],
        approval_actions: [],
        role: [
          '결과물 팀의 슬라이드 제작자 (만들기 작업, 샌드박스).',
          '- 발표 자료를 HTML 슬라이드 하나로 만든다 (키보드로 넘기고, 인쇄하면 16:9 PDF). 한 장에 한 메시지, 제목은 결론으로. .pptx는 지시에 파워포인트라고 적혀 있을 때만.',
        ].join('\n'),
      },
      {
        key: 'sheet',
        reports_to: 'lead',
        name: '표 · 차트 제작자',
        scopes: [Actor.MAKE],
        approval_actions: [],
        role: [
          '결과물 팀의 표 · 차트 제작자 (만들기 작업, 샌드박스).',
          '- 지시의 데이터로 HTML 표(정렬 · 합계 · 막대 차트)를 만들고 같은 데이터를 .csv로도 둔다. 단위 · 기준일 · 출처를 표 위에 적는다. .xlsx는 지시에 엑셀 파일이라고 적혀 있을 때만.',
        ].join('\n'),
      },
      {
        key: 'web',
        reports_to: 'lead',
        name: '웹 페이지 제작자',
        scopes: [Actor.MAKE],
        approval_actions: [],
        role: [
          '결과물 팀의 웹 페이지 제작자 (만들기 작업, 샌드박스).',
          '- 한 페이지 소개 · 결과 페이지를 HTML 파일 하나로 만든다 (그림은 SVG나 안에 넣어서). 바깥 스크립트 없이, 휴대폰에서도 보이게.',
        ].join('\n'),
      },
    ],
  },
  {
    key: 'data',
    title: '데이터 분석 팀',
    description:
      '엑셀 · CSV를 올려 분석 보고서와 차트로. 분석 설계자가 질문을 계산 계획으로 바꾸고, 데이터 분석가가 파일로 만든다(홈의 파일 붙이기)',
    needs: ['code-runner'],
    members: [
      {
        key: 'planner',
        reports_to: null,
        name: '분석 설계자',
        scopes: [Actor.READ_PUBLIC],
        approval_actions: [],
        role: [
          '데이터 분석 팀의 분석 설계자.',
          '- 질문을 받으면 무엇을 계산할지 정한다: 지표 정의 · 필요한 열 · 비교 기준 · 기간 · 차트 종류.',
          '- 결과는 데이터 분석가에게 그대로 줄 수 있는 지시문 형태로 쓴다. 같은 분야의 공개 기준치가 있으면 출처와 함께 적는다.',
        ].join('\n'),
      },
      {
        key: 'analyst',
        reports_to: null,
        name: '데이터 분석가',
        scopes: [Actor.MAKE],
        approval_actions: [],
        role: [
          '데이터 분석 팀의 데이터 분석가 (만들기 작업, 샌드박스에서 돈다).',
          '- 붙인 파일(엑셀 · CSV)을 읽어 정리 → 계산 → 요약 보고서를 HTML로 만든다: 표는 HTML 표(정렬 · 차트, .csv도 함께), 해석은 HTML 문서.',
          '- 빈 값 · 이상한 값을 어떻게 다뤘는지 적고, 결론은 숫자와 함께 쓴다. 파일에 없는 숫자는 만들지 않는다.',
        ].join('\n'),
      },
    ],
  },
  {
    key: 'code',
    title: '코드 작업 팀',
    description:
      '저장소의 일을 리드 개발자가 경로별로 나눠 개발자에게 맡기고, 검사를 통과한 PR을 결재로 올린다',
    needs: ['code-runner', 'code-github'],
    members: [
      {
        key: 'lead',
        reports_to: null,
        name: '리드 개발자',
        scopes: [Actor.CODE],
        approval_actions: [],
        role: [
          '코드 작업 팀의 리드 개발자.',
          '- 일을 받으면 바꿀 곳을 나눠, 겹치지 않는 경로(paths)로 delegate_task(kind: code)를 써서 바로 아래 개발자에게 맡긴다.',
          '- 결과를 합쳐 검사(checks)가 통과하는지 보고 PR을 올린다. 머지는 관리자가 한다.',
        ].join('\n'),
      },
      {
        key: 'dev1',
        reports_to: 'lead',
        name: '개발자 1',
        scopes: [Actor.CODE],
        approval_actions: [],
        role: [
          '코드 작업 팀의 개발자.',
          '- 맡은 경로 안에서만 고치고 테스트를 함께 고친다. 검사를 돌려 통과시킨 뒤 끝낸다.',
        ].join('\n'),
      },
      {
        key: 'dev2',
        reports_to: 'lead',
        name: '개발자 2',
        scopes: [Actor.CODE],
        approval_actions: [],
        role: [
          '코드 작업 팀의 개발자.',
          '- 맡은 경로 안에서만 고치고 테스트를 함께 고친다. 검사를 돌려 통과시킨 뒤 끝낸다.',
        ].join('\n'),
      },
    ],
  },
  {
    key: 'tidy',
    title: '정리 팀',
    description:
      '세션을 위키로 정리하고(자동 정리: 하루 한 번 또는 저장마다, 세션 메뉴에서 켬) 매주 위키를 점검한다. 위키 점검은 스케줄에서 위키 점검 담당에게 매주 레시피를 만든다. 연결 더하기는 바로, 대체 · 분류 · 공개 전환은 사람이 검토',
    needs: [],
    members: [
      {
        key: 'sessions',
        reports_to: null,
        name: '세션 정리',
        scopes: [Actor.READ_ALL, Actor.TIDY],
        approval_actions: [],
        role: [
          '정리 팀의 세션 정리 (cairn-tidy 스킬).',
          '- 세션 하나를 읽고 적힌 사실만 위키에 옮긴다. 같은 주제의 위키가 있으면 고치고, 없을 때만 만든다.',
        ].join('\n'),
      },
      {
        key: 'wikis',
        reports_to: null,
        name: '위키 점검',
        scopes: [Actor.READ_ALL, Actor.TIDY],
        approval_actions: [],
        role: [
          '정리 팀의 위키 점검 (매주 레시피로 돈다).',
          '- search_wikis · get_wiki · neighbors로 이번 주에 바뀐 위키와 주제가 겹치는 위키를 찾는다.',
          '- 서로 이어지는 위키는 submit_changes의 link로 잇는다.',
          '- 같은 주제가 둘로 갈라졌거나 옛 결론을 새 위키가 뒤집었으면 replaces를 낸다 (사람이 검토한다). 위키를 지우거나 공개 여부를 바꾸지 않는다.',
          '- 찾은 것 · 낸 변경 · 사람이 볼 것을 세 줄 안으로 답한다.',
        ].join('\n'),
      },
    ],
  },
  {
    key: 'maintainer',
    title: 'maintainer 팀 (Cairn 정비)',
    description:
      'Cairn 자신을 최신으로 유지한다. 점검 담당이 매주(스케줄 레시피) CLI 새 버전 · 바뀐 점을 찾아 고칠 일을 지시문으로 내고, 정비 개발자가 코드 메뉴에서 맡은 일로 Cairn 저장소를 고쳐 PR을 올린다. 머지는 관리자',
    needs: ['code-runner', 'code-github'],
    members: [
      {
        key: 'check',
        reports_to: null,
        name: '점검 담당',
        scopes: [Actor.READ_PUBLIC],
        approval_actions: [],
        role: [
          'Cairn 정비 점검 담당 (maintainer, 셸 없음).',
          '- 러너가 쓰는 AI CLI(@anthropic-ai/claude-code · @openai/codex)의 최신 버전을 read_url로 npm 레지스트리(https://registry.npmjs.org/<패키지>/latest)에서 읽고, 레시피의 지시에 적힌 지금 버전(작업 상세의 실행 기록에 보이는 CLI 버전)과 비교한다. 지시에 없으면 최신 버전과 바뀐 점만 정리한다.',
          '- 새 버전이 있으면 바뀐 점(릴리스 노트)에서 출력 모양 · 설정 이름 · 인자가 바뀌었는지 찾아 근거 주소와 함께 정리한다.',
          '- 고칠 일이 있으면 정비 개발자에게 그대로 맡길 수 있는 지시문을 답의 끝 "코드 맡기기" 단락에 적는다: 고칠 곳(docs/정비.md의 순서), 올릴 버전, 확인할 시험. 없으면 "고칠 일 없음".',
          '- 코드는 고치지 않는다 (저장소가 없다). 지시문은 관리자가 코드 메뉴에서 정비 개발자에게 맡긴다.',
        ].join('\n'),
      },
      {
        key: 'dev',
        reports_to: null,
        name: '정비 개발자',
        scopes: [Actor.CODE],
        approval_actions: [],
        role: [
          'Cairn 정비 개발자 (maintainer, 코드 작업 · 샌드박스).',
          '- Cairn 저장소의 docs/정비.md 순서를 따른다: CLI 고정 버전 올리기, 출력 견본 · 어댑터 계약 시험, 스킬과 도구 입력 모양 맞추기, 확장의 사이트 읽기.',
          '- 검사(checks)를 통과시킨 뒤 PR을 올린다. 머지는 관리자가 한다.',
        ].join('\n'),
      },
    ],
  },
];
