// 옛 이름의 스크립트 주소 (2026-11-28 이름 cairn → moida): 그 전에 만든 앱 코드가 싣는 /_/cairn.js에 moida.js와 같은 것을 준다.
// 스크립트는 window.moida와 같은 것을 window.cairn에도 둔다 (moida-client.ts)
export const dynamic = 'force-dynamic';

export { GET } from '../moida.js/route';
