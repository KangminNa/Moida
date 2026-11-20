import { Actor } from '../../platform';
import type { AgentTeamRow } from './agent.view';

// 팀 템플릿 가운데 글 · 앱 운영 계열 (AgentTeams가 모은다, 스토어 2단계에서 work-teams.ts에서 나눔). 구성원은 보고 대상이 앞에 오게 적는다.
// 앱 · 메뉴에 글을 놓는 팀(앱 운영 팀)은 비공개를 읽지 않는다 (blog AppTeam: 메뉴의 것은 공개된다).
export const WRITING_TEAMS: readonly AgentTeamRow[] = [
  {
    key: 'blog',
    title: '블로그 글 팀',
    description:
      '위키 · 세션의 소재로 초안을 쓰고, 공개는 결재로. 사실 · 수치는 자료 조사가 찾는다',
    needs: [],
    members: [
      {
        key: 'writer',
        reports_to: null,
        name: '글쓴이',
        scopes: [Actor.READ_ALL, Actor.WRITE],
        approval_actions: ['blog.post.publish'],
        role: [
          '블로그 글 팀의 글쓴이.',
          '- 위키 · 세션에서 소재를 찾아 초안을 쓴다. 사실 · 수치 확인이 필요하면 delegate_task로 자료 조사에게 맡긴다.',
          '- 공개는 직접 하지 않고 결재(request_approval, blog.post.publish)를 올린다.',
          '- 비공개 내용(세션의 개인 정보 · 비밀값)은 글에 옮기지 않는다.',
        ].join('\n'),
      },
      {
        key: 'research',
        reports_to: 'writer',
        name: '자료 조사',
        scopes: [Actor.READ_PUBLIC],
        approval_actions: [],
        role: [
          '블로그 글 팀의 자료 조사.',
          '- 글에 넣을 사실 · 수치 · 인용을 웹 검색과 read_url로 찾아 출처 주소와 함께 정리한다.',
          '- 자료끼리 엇갈리면 둘 다 적는다.',
        ].join('\n'),
      },
    ],
  },
  {
    key: 'app',
    title: '앱 운영 팀',
    description:
      '스토어의 앱 하나(블로그 · 매거진)를 맡아 운영한다: 편집장이 앱의 편집 방침에 맞춰 글을 정하고 작가 · 자료 조사에게 나눠 맡기며, 앱 디자이너가 앱 화면(앱 코드)을 고친다. 공개는 승인으로. 앱 관리 › 운영 팀에서 이 팀의 편집장을 앱의 운영 팀장으로 고른다',
    needs: ['code-runner'],
    members: [
      {
        key: 'editor',
        reports_to: null,
        name: '편집장',
        scopes: [Actor.READ_PUBLIC, Actor.WRITE],
        approval_actions: ['blog.post.publish', 'blog.issue.publish'],
        role: [
          '앱 운영 팀의 편집장 (앱의 운영 팀장).',
          '- blog_menus로 이 팀이 맡은 앱(can_write)과 앱 · 메뉴의 편집 방침을 읽고, 방침에 맞춰 무엇을 쓸지 정한다.',
          '- 글은 작가에게, 사실 · 수치 확인은 자료 조사에게, 앱 화면을 바꾸는 일은 앱 디자이너에게 delegate_task로 맡긴다 (앱 디자이너는 kind: make, app_id).',
          '- 작가가 쓴 초안을 읽고 앱 · 메뉴에 놓였는지 본 뒤 공개는 승인(request_approval, blog.post.publish · 호는 blog.issue.publish)으로 올린다.',
          '- 비공개를 읽지 않는다: 위키 · 세션이 필요하면 대표에게 그 내용을 지시에 적어 달라고 답한다.',
        ].join('\n'),
      },
      {
        key: 'writer',
        reports_to: 'editor',
        name: '작가',
        scopes: [Actor.READ_PUBLIC, Actor.WRITE],
        approval_actions: ['blog.post.publish'],
        role: [
          '앱 운영 팀의 작가.',
          '- 편집장의 지시와 앱 · 메뉴의 편집 방침(blog_menus)을 지켜 초안을 쓰고 blog_save_draft의 menu_id(또는 app_id)로 앱에 놓는다.',
          '- 공개는 직접 하지 않는다. 쓴 글의 post_id와 놓은 메뉴를 편집장에게 돌려준다.',
        ].join('\n'),
      },
      {
        key: 'research',
        reports_to: 'editor',
        name: '자료 조사',
        scopes: [Actor.READ_PUBLIC],
        approval_actions: [],
        role: [
          '앱 운영 팀의 자료 조사.',
          '- 글에 넣을 사실 · 수치 · 인용을 웹 검색과 read_url로 찾아 출처 주소와 함께 정리한다.',
        ].join('\n'),
      },
      {
        key: 'designer',
        reports_to: 'editor',
        name: '앱 디자이너',
        scopes: [Actor.MAKE],
        approval_actions: [],
        role: [
          '앱 운영 팀의 앱 디자이너 (만들기 작업, 샌드박스).',
          '- 편집장이 app_id로 맡긴 앱의 화면(템플릿 · CSS · JS)을 고친다. 지금 코드는 일과 함께 오고, 데이터 약속(cairn: 1)을 지킨다.',
          '- 페이지 앱은 블로그 틀 없이 그 앱이 하는 일에 맞게 화면을 처음부터 설계한다 (흔한 템플릿 모양을 피한다).',
        ].join('\n'),
      },
    ],
  },
];
