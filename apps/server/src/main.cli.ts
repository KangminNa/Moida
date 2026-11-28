import 'reflect-metadata';
import { InstallPolicy, OwnerService, SpaceQuery } from './modules/account';
import {
  ArchiveFile,
  ArchiveRestoreService,
  FailedEventInput,
  FailedEventQuery,
  FailedEventService,
  InvalidRequest,
  OwnerActor,
  PluginManifest,
  PluginRegistry,
  PluginService,
  SecretRotation,
  SystemActor,
  TooLarge,
  ZipLimits,
} from './modules/platform';
import { MoidaApp } from './moida-app';

// 명령줄. 서버에 접속할 수 있는 사람 = 주인으로 본다. 관리 화면·설치 마법사도 같은 Service를 부른다.
//
//   pnpm install-code                            설치 코드 (아직 주인이 없을 때)
//   pnpm run owner reset-password                    주인 비밀번호 다시 정하기 (표준 입력으로, 모든 로그인이 끝남)
//   pnpm plugin                                  들어 있는 플러그인과 상태
//   pnpm plugin enable <플러그인>                 켜기 (쓰는 권한을 보여주고 허락)
//   pnpm plugin disable <플러그인>                끄기
//   pnpm plugin set <플러그인> <설정> [값]         값 넣기. 값을 빼면 표준 입력에서 읽음 (비밀값용)
//   pnpm plugin <플러그인> <동작>                  관리 동작 (예: sync-github check)
//   pnpm secret:rotate                           저장된 비밀값을 지금 서버 키로 다시 암호화 (순서는 .env.example)
//   pnpm run restore < 백업.zip                  백업 zip을 검사하고 무엇이 몇 개 들어올지 보여줌. 아무것도 쓰지 않음
//   pnpm run restore --apply < 백업.zip          빈 Moida에 정말 들여옴
//   pnpm run events failed                       8번 실패해 멈춘 이벤트 (최근 50개)
//   pnpm run events retry <번호|--all>            멈춘 이벤트를 다시 시도 (웹의 설정 › 일 › 처리 실패와 같다)
//
// 컨테이너 안에서는 개발·운영 모두 moida-admin <명령>으로 부른다 (Dockerfile).
const owner = new OwnerActor('local', 'cli');

async function main() {
  const [command, ...args] = process.argv.slice(2);
  const app = await MoidaApp.cli();
  try {
    if (command === 'install-code')
      return await installCode(app.get(SpaceQuery), app.get(InstallPolicy));
    if (command === 'owner' && args[0] === 'reset-password')
      return await resetPassword(app.get(OwnerService));
    if (command === 'plugin')
      return await plugin(
        app.get(PluginRegistry),
        app.get(PluginService),
        args,
        await ownerOfSpace(app.get(SpaceQuery)),
      );
    if (command === 'restore')
      return await restore(app.get(ArchiveRestoreService), app.get(SpaceQuery), args);
    if (command === 'events')
      return await events(app.get(FailedEventQuery), app.get(FailedEventService), args);
    if (command === 'secret' && args[0] === 'rotate')
      return await rotateSecrets(app.get(SecretRotation));
    throw new Error('명령을 알 수 없어요. 쓰는 법은 apps/server/src/main.cli.ts 맨 위에');
  } finally {
    await app.close();
  }
}

async function installCode(spaces: SpaceQuery, install: InstallPolicy): Promise<void> {
  const status = await spaces.installStatus(new SystemActor(), null);
  if (status.installed) {
    console.log('이미 설치된 블로그예요. 로그인하세요');
    return;
  }
  console.log(`설치 코드: ${install.code()}`);
  console.log(
    `브라우저에서 ${process.env.MOIDA_WEB_URL ?? 'http://localhost:3000'}/install 을 열고 이 코드를 넣으세요`,
  );
}

async function resetPassword(owners: OwnerService): Promise<void> {
  const plain = await readStdin(
    '새 비밀번호를 표준 입력으로 주세요. 예: read -rs P && printf %s "$P" | pnpm run owner reset-password',
  );
  const owner = await owners.resetPassword(new SystemActor(), plain);
  console.log(`✔ ${owner.login}의 비밀번호를 다시 정했어요. 모든 로그인이 끝났어요`);
}

async function rotateSecrets(rotation: SecretRotation): Promise<void> {
  const counts = await rotation.run(owner);
  for (const [name, count] of counts) console.log(`✔ ${name}: ${count}개를 다시 암호화했어요`);
  console.log('모든 비밀값이 지금 서버 키로 풀려요. MOIDA_SECRET_KEY_OLD를 지워도 돼요');
}

/** 멈춘 이벤트 보기 · 다시 시도 (리팩토링 R1). 서버 자신(SystemActor)이라 모든 공간을 본다 */
async function events(
  failed: FailedEventQuery,
  retries: FailedEventService,
  args: readonly string[],
): Promise<void> {
  const [verb, target] = args;
  const system = new SystemActor();
  if (verb === 'failed') {
    const { items } = (await failed.list(system)).toJSON();
    if (items.length === 0) return console.log('멈춘 이벤트가 없어요');
    for (const e of items)
      console.log(
        `${e.id}  ${e.failedAt}  ${e.topic}  (요청 번호 ${e.traceId ?? '-'})\n    ${e.lastError ?? ''}`,
      );
    return;
  }
  if (verb === 'retry' && target === '--all') {
    console.log(`✔ ${await retries.retryAll(system)}개를 다시 시도하게 돌렸어요`);
    return;
  }
  if (verb === 'retry' && target) {
    const event = (await retries.retry(system, FailedEventInput.from({ id: target }))).toJSON();
    console.log(`✔ ${event.id}(${event.topic})를 다시 시도하게 돌렸어요. 일꾼이 곧 처리해요`);
    return;
  }
  throw new Error('쓰는 법: events failed | events retry <번호|--all>');
}

/** 공간을 아는 주인. 공간에 쓰는 동작(저장소에서 복원)은 진짜 공간 id가 있어야 한다 */
async function ownerOfSpace(spaces: SpaceQuery): Promise<OwnerActor> {
  const { spaceId } = await spaces.installStatus(new SystemActor(), null);
  return spaceId ? new OwnerActor(spaceId, 'cli') : owner;
}

async function restore(
  restores: ArchiveRestoreService,
  spaces: SpaceQuery,
  args: readonly string[],
): Promise<void> {
  const unknown = args.find((arg) => arg !== '--apply');
  if (unknown) throw new Error(`모르는 옵션이에요: ${unknown}. 쓸 수 있는 옵션은 --apply 하나예요`);
  const files = ArchiveFile.unzip(await readStdinBytes());
  const system = new SystemActor();
  if (!args.includes('--apply')) {
    const report = await restores.preview(system, files);
    console.log(`들어올 내용: ${report.summary}`);
    for (const note of report.notes) console.log(`  ${note}`);
    console.log('아직 아무것도 넣지 않았어요. 넣으려면 --apply를 붙여 다시 실행하세요');
    return;
  }
  const { spaceId } = await spaces.installStatus(system, null);
  const report = await restores.apply(system, spaceId, files);
  console.log(`✔ 복원했어요: ${report.summary}`);
  for (const note of report.notes) console.log(`  ${note}`);
  console.log('기기는 다시 연결해 주세요: pnpm moida connect <블로그 주소>');
}

async function plugin(
  registry: PluginRegistry,
  plugins: PluginService,
  args: readonly string[],
  owner: OwnerActor,
): Promise<void> {
  const [first, name, key, value] = args;
  if (!first) return list(registry);
  if (first === 'enable' && name) {
    const manifest = registry.manifest(name);
    if (!manifest) throw new Error(`들어 있는 플러그인 중에 ${name}이(가) 없어요`);
    await plugins.enable(owner, name);
    console.log(`✔ ${name}을(를) 켰어요. 허락한 것:`);
    for (const use of manifest.uses) console.log(`  · ${PluginManifest.describeUse(use)}`);
    return report(registry, name);
  }
  if (first === 'disable' && name) {
    await plugins.disable(owner, name);
    console.log(`✔ ${name}을(를) 껐어요`);
    return;
  }
  if (first === 'set' && name && key) {
    const input = value ?? (await readStdin());
    await plugins.set(owner, name, key, input);
    const secret = registry.manifest(name)?.setting(key)?.isSecret;
    console.log(`✔ ${name}.${key} = ${secret ? '(비밀값, 암호화해서 저장)' : input || '(지움)'}`);
    return report(registry, name);
  }
  if (name) {
    const found = registry.action(first, name);
    if (!found)
      throw new Error(
        `${first}에 없는 동작이에요: ${name} (켜져 있고 설정이 끝났는지 pnpm plugin 으로 확인해 주세요)`,
      );
    const result = await found.action.run(owner);
    console.log(`${result.ok ? '✔' : '✖'} ${result.message}`);
    for (const line of result.details) console.log(`  ${line}`);
    process.exitCode = result.ok ? 0 : 1;
    return;
  }
  throw new Error('명령을 알 수 없어요. 쓰는 법은 apps/server/src/main.cli.ts 맨 위에');
}

function list(registry: PluginRegistry): void {
  for (const m of registry.installed()) {
    const state = registry.state(m.name);
    const status = !state?.enabled
      ? '꺼짐'
      : !state.isActiveFor(m)
        ? '켜짐 (다시 허락 필요)'
        : registry.problem(m.name)
          ? '켜짐 (동작하지 못함)'
          : '켜짐';
    console.log(`${m.name} ${m.version} [${status}]  ${m.description}`);
    report(registry, m.name);
  }
}

function report(registry: PluginRegistry, name: string): void {
  const m = registry.manifest(name);
  if (!m) return;
  const state = registry.state(name);
  for (const spec of m.settings) {
    const stored = state?.storedSetting(spec.key);
    const shown = !stored
      ? spec.defaultValue
        ? `(기본값 ${spec.defaultValue})`
        : '(비어 있음)'
      : spec.isSecret
        ? '(설정됨)'
        : stored.value;
    console.log(`    ${spec.key}${spec.required ? '*' : ''}  ${spec.label}: ${shown}`);
  }
  const problem = registry.problem(name);
  if (problem) console.log(`    ✖ 동작하지 못함: ${problem}`);
  for (const a of registry.actions().filter((x) => x.plugin === name)) {
    console.log(`    → pnpm plugin ${name} ${a.name}   ${a.action.label}`);
  }
}

async function readStdin(
  hint = '값을 주세요. 비밀값은 echo 값 | pnpm plugin set … 처럼 표준 입력으로 넘기세요',
): Promise<string> {
  if (process.stdin.isTTY) throw new Error(hint);
  let data = '';
  for await (const chunk of process.stdin) data += chunk;
  return data.trim();
}

/** 표준 입력을 바이트 그대로. 한도를 넘으면 다 읽기 전에 멈춘다 */
async function readStdinBytes(): Promise<Buffer> {
  if (process.stdin.isTTY)
    throw new Error('백업 zip을 표준 입력으로 주세요. 예: pnpm run restore < 백업.zip');
  const limit = ZipLimits.DEFAULT.maxZipBytes;
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    size += (chunk as Buffer).length;
    if (size > limit)
      throw new TooLarge(`백업 zip이 너무 커요 (${Math.round(limit / 1024 ** 2)}MB까지)`);
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

main().catch((error) => {
  console.error(`✖ ${(error as Error).message}`);
  if (error instanceof InvalidRequest)
    for (const [field, problem] of error.fields) console.error(`  ${field}: ${problem}`);
  process.exit(1);
});
