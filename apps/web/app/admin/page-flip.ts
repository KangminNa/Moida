import { DOCK } from './menu';

// 독의 화면 사이를 오갈 때 카드가 위아래로 넘어간다 (CSS 문서 간 화면 전환, globals.css의 @view-transition).
// 메뉴는 일반 링크라(글 편집기의 "저장 안 한 내용" 확인) 페이지가 새로 열리고, 방향은 새 페이지가 첫 그림 전에 정해야 한다(pagereveal).
// 그래서 머리의 고정 스크립트로 둔다. 독에서 아래쪽 화면으로 가면 위로(flip-up), 위쪽으로 가면 아래로(flip-down) 넘긴다.
// 같은 화면 안(대화 사이, 설정 사이)이나 콘솔 밖은 넘기지 않는다. 주소 → 몇 번째 화면은 menu.tsx의 placeOf와 같은 규칙
// (가장 길게 맞는 주소, /admin은 그 주소만, 독에 없는 콘솔 주소는 설정 = 마지막).
// 넘기지 않을 때 skipTransition()은 ready를 거절한다: 받아 두지 않으면 페이지 오류(처리 안 된 거절)로 찍힌다

/** 화면마다 그 화면에 속한 주소들 (독 순서) */
const SECTIONS = JSON.stringify(DOCK.map((s) => s.pages.map((p) => p.href)));

/** 머리에 넣는 고정 스크립트. 입력값 없이 메뉴 파일의 주소로만 만든다 */
export const PAGE_FLIP_SCRIPT = `(function(){var S=${SECTIONS};
function at(u){var p;try{p=new URL(u).pathname}catch(e){return -1}
if(p!=='/admin'&&p.indexOf('/admin/')!==0)return -1;
var b=S.length,n=0;for(var i=0;i<S.length;i++)for(var j=0;j<S[i].length;j++){var h=S[i][j];
if((p===h||(h!=='/admin'&&p.indexOf(h+'/')===0))&&h.length>n){b=i;n=h.length}}return b}
addEventListener('pagereveal',function(e){var t=e.viewTransition;if(!t)return;
var f=typeof navigation!=='undefined'&&navigation.activation&&navigation.activation.from;
var a=f?at(f.url):-1,b=at(location.href);
if(a<0||b<0||a===b){t.ready.catch(function(){});t.skipTransition();return}
t.types.add(b>a?'flip-up':'flip-down')})})()`;
