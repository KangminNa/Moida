// 앱 코드 배포 (moida app deploy가 띄운다, 스토어 12.5). Node 내장 모듈만 쓴다.
//
//   node moida-deploy.mjs <앱 주소> <zip 파일> [메모]
//
// 배포 기기(credentials.json의 deploy)로 MCP app_code_upload를 불러 표를 받고, 그 표로 zip을 PUT한다
// (기기 토큰은 /mcp에서만 통하고 JSON 본문은 512KB까지라 묶음은 표로 낸다).
// 결과를 JSON 한 줄로 찍는다: { state } | { refused: { code, message } } | { disconnected: true } | { failed: 글 }.
// 토큰 · 표는 찍지 않는다.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { callTool, Disconnected, deviceCredential } from './device-access.mjs';

const DEVICE = 'deploy';
/** 표 받기와 올리기를 합쳐 기다리는 시간 */
const TIMEOUT_MS = 120_000;

async function deploy(app, file, note) {
  const zip = readFileSync(file);
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  const reply = await callTool(
    DEVICE,
    'app_code_upload',
    {
      app,
      size: zip.length,
      sha256: createHash('sha256').update(zip).digest('hex'),
      ...(note ? { note } : {}),
    },
    signal,
    true,
  );
  if (reply.refused) return { refused: reply.refused };
  const { upload_path: path, header, token } = reply.value;
  const site = deviceCredential(DEVICE)?.site ?? '';
  // 표를 낼 곳은 연결한 블로그의 경로뿐이다 (답에 다른 주소가 실려 와도 묶음을 그리로 보내지 않는다)
  if (typeof path !== 'string' || !/^\/api\/[^\s]*$/.test(path) || typeof header !== 'string')
    throw new Error('블로그가 올릴 곳을 알려 주지 않았어요');
  const res = await fetch(`${site}${path}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/zip', [header]: String(token) },
    body: zip,
    signal,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok)
    return {
      refused: {
        code: String(body.code ?? res.status),
        message: String(body.message ?? `서버가 ${res.status}로 답했어요`),
      },
    };
  return { state: body };
}

const [app, file, note = ''] = process.argv.slice(2);
const print = (result) => process.stdout.write(`${JSON.stringify(result)}\n`);
deploy(app, file, note).then(print, (error) =>
  print(
    error instanceof Disconnected
      ? { disconnected: true }
      : { failed: String(error?.message ?? error) },
  ),
);
