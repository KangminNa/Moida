// 플러그인이 앱 라이브러리(moida.js)에 붙이는 브라우저 스크립트 하나 (목록 파일 client.file, 2026-11-28).
// 글자는 `function (moida, settings) { … }`의 몸통이다: moida.js가 켜진 플러그인의 것만 공개 설정과 함께 부른다
export type PluginClientSource = { plugin: string; source: string };
