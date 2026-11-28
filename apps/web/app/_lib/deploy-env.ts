// 배포가 정한 환경 변수 읽기 (웹 서버 쪽만). 새 이름 MOIDA_<이름>이 먼저이고, 없으면 옛 이름 CAIRN_<이름>을 읽는다
// (2026-11-28 이름 cairn → moida: 이미 배포한 .env가 옛 이름이어도 그대로 돌게. 서버 · 러너는 시작할 때 LegacyEnv가 옮긴다)
export function deployEnv(
  name: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): string | undefined {
  return env[`MOIDA_${name}`] ?? env[`CAIRN_${name}`];
}
