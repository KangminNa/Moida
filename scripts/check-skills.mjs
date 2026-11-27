// 스킬 · 지침 문서 검사 (2026-11-24, 규칙은 agnix의 스킬 · 지침 검사에서 골라 다시 씀). pnpm check가 돌린다.
//
//   1. skills/<이름>/SKILL.md의 앞부분: name은 폴더 이름과 같고, 칸은 name · description · cairn-where만 (cairn-where는 runner만)
//   2. description은 1~1024자, `<` `>` 없음 (Codex에도 깔린다), 언제 쓰는지("쓴다")가 들어 있다 (지시문 틀 cairn-runner는 빼고).
//      모든 description을 합쳐 8000자 안 (AI 도구가 스킬 목록을 늘 싣는다)
//   3. SKILL.md는 500줄까지 (Codex는 스킬 글 전체를 지시문에 싣는다: 길이가 곧 토큰)
//   4. references/의 파일은 그 스킬 어딘가에서 가리킨다 (아무도 읽지 않는 참고 파일을 남기지 않는다)
//   5. 지침 문서(skills · docs · AGENTS.md · CLAUDE.md들)의 상대 경로 md 링크가 실제로 있다 (문서 이름을 바꿀 때 깨지기 쉽다)
//   6. 스킬에 비밀값 모양(sk-ant- · ghp_ · AKIA)과 개인 절대 경로(/home/<이름> · /Users/)가 없다
//   7. 러너 스킬과 지시문 틀에 옛 말(팀원 · 팀장)이 없다 (2026-11-21 팀 없음 결정. 일꾼 · 대표로 쓴다)
//   8. AGENTS.md의 명령 표에 적은 `pnpm <스크립트>`가 package.json에 있다
//   9. 러너 스킬과 지시문 틀은 콘솔에서 고칠 수 있는 크기다: 파일 하나 96KB · 합쳐 128KB (서버 SkillFiles와 같은 값, 2026-11-27:
//      저장소 판이 한도를 넘으면 콘솔에서 새 버전을 쌓지 못한다)
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const skillsDir = join(root, 'skills');
const problems = [];
const rel = (p) => relative(root, p);

const KEYS = new Set(['name', 'description', 'cairn-where']);
const TEMPLATE_SKILLS = new Set(['cairn-runner']);
const OLD_WORDS = ['팀원', '팀장'];
const SECRET = [/sk-ant-[A-Za-z0-9_-]{8}/, /ghp_[A-Za-z0-9]{20}/, /AKIA[0-9A-Z]{16}/];
const PERSONAL_PATH = [/\/home\/(?!user\b)[a-z][\w-]*\//, /\/Users\/[\w-]+\//];
const PNPM_BUILTINS = new Set(['run', 'install', 'exec', 'dlx', 'add', 'i', 'test']);
const SKILL_FILE_MAX = 96 * 1024;
const SKILL_TOTAL_MAX = 128 * 1024;

function files(dir, pick) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'node_modules' ? [] : files(path, pick);
    return pick(name) ? [path] : [];
  });
}

function frontmatter(text) {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!m) return null;
  return Object.fromEntries(
    m[1].split('\n').flatMap((line) => {
      const at = line.indexOf(':');
      return at > 0 ? [[line.slice(0, at).trim(), line.slice(at + 1).trim()]] : [];
    }),
  );
}

let descriptions = 0;
for (const name of readdirSync(skillsDir).filter((n) =>
  statSync(join(skillsDir, n)).isDirectory(),
)) {
  const dir = join(skillsDir, name);
  const skillPath = join(dir, 'SKILL.md');
  if (!existsSync(skillPath)) {
    problems.push(`${rel(dir)}: SKILL.md가 없어요`);
    continue;
  }
  const text = readFileSync(skillPath, 'utf8');
  const head = frontmatter(text);
  if (!head) {
    problems.push(`${rel(skillPath)}: 앞부분(--- … ---)이 없어요`);
    continue;
  }
  if (head.name !== name)
    problems.push(`${rel(skillPath)}: name(${head.name})이 폴더 이름과 달라요`);
  for (const key of Object.keys(head))
    if (!KEYS.has(key)) problems.push(`${rel(skillPath)}: 모르는 앞부분 칸 ${key}`);
  if (head['cairn-where'] !== undefined && head['cairn-where'] !== 'runner')
    problems.push(`${rel(skillPath)}: cairn-where는 runner만 써요`);
  const description = head.description ?? '';
  descriptions += description.length;
  if (description.length < 1 || description.length > 1024)
    problems.push(`${rel(skillPath)}: description은 1~1024자 (${description.length}자)`);
  if (/[<>]/.test(description))
    problems.push(`${rel(skillPath)}: description에 < > 를 쓰지 않아요`);
  if (!TEMPLATE_SKILLS.has(name) && !description.includes('쓴다'))
    problems.push(`${rel(skillPath)}: description에 언제 쓰는지("…때 쓴다")가 없어요`);
  const lines = text.split('\n').length;
  if (lines > 500) problems.push(`${rel(skillPath)}: 500줄을 넘어요 (${lines}줄)`);

  const all = files(dir, (n) => n.endsWith('.md'));
  const joined = all.map((p) => readFileSync(p, 'utf8')).join('\n');
  for (const ref of files(join(dir, 'references'), () => true)) {
    const base = ref.slice(ref.lastIndexOf('/') + 1);
    const others = all
      .filter((p) => p !== ref)
      .map((p) => readFileSync(p, 'utf8'))
      .join('\n');
    if (!others.includes(base)) problems.push(`${rel(ref)}: 스킬 어디에서도 가리키지 않아요`);
  }
  for (const path of files(dir, () => true)) {
    const body = readFileSync(path, 'utf8');
    if (SECRET.some((re) => re.test(body))) problems.push(`${rel(path)}: 비밀값 모양이 있어요`);
    if (PERSONAL_PATH.some((re) => re.test(body)))
      problems.push(`${rel(path)}: 개인 절대 경로가 있어요`);
  }
  if (head['cairn-where'] === 'runner' || TEMPLATE_SKILLS.has(name)) {
    const sizes = files(dir, () => true).map((p) => [p, statSync(p).size]);
    for (const [path, size] of sizes)
      if (size > SKILL_FILE_MAX)
        problems.push(
          `${rel(path)}: 콘솔에서 고칠 수 있는 ${SKILL_FILE_MAX / 1024}KB를 넘어요 (${size}바이트)`,
        );
    const total = sizes.reduce((sum, [, size]) => sum + size, 0);
    if (total > SKILL_TOTAL_MAX)
      problems.push(
        `skills/${name}: 파일을 합쳐 ${SKILL_TOTAL_MAX / 1024}KB를 넘어요 (${total}바이트)`,
      );
  }
  if (head['cairn-where'] === 'runner' || TEMPLATE_SKILLS.has(name))
    for (const word of OLD_WORDS)
      if (joined.includes(word))
        problems.push(`skills/${name}: 옛 말 "${word}" (일꾼 · 대표로 써요)`);
}
if (descriptions > 8000)
  problems.push(`skills: description을 모두 합쳐 8000자를 넘어요 (${descriptions}자)`);

// 5. 지침 문서의 상대 링크
const guides = [
  join(root, 'AGENTS.md'),
  join(root, 'CLAUDE.md'),
  ...files(join(root, 'docs'), (n) => n.endsWith('.md')),
  ...files(skillsDir, (n) => n.endsWith('.md')),
  ...files(join(root, 'apps/server/src/modules'), (n) => n === 'CLAUDE.md'),
  ...files(join(root, '.claude/rules'), (n) => n.endsWith('.md')),
  join(root, 'plugins/CLAUDE.md'),
].filter(existsSync);
for (const path of guides) {
  const body = readFileSync(path, 'utf8').replace(/```[\s\S]*?```/g, '');
  for (const [, target] of body.matchAll(/\]\(([^)\s]+)\)/g)) {
    if (/^(https?:|mailto:|#|\/)/.test(target)) continue;
    const file = decodeURIComponent(target.split('#')[0]);
    if (file && !existsSync(resolve(dirname(path), file)))
      problems.push(`${rel(path)}: 없는 파일을 가리켜요 (${target})`);
  }
}

// 8. AGENTS.md 명령 표의 pnpm 스크립트
const scripts = new Set(
  Object.keys(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).scripts),
);
const agents = readFileSync(join(root, 'AGENTS.md'), 'utf8');
for (const [, first, second] of agents.matchAll(/`pnpm ([\w:-]+)(?: ([\w:-]+))?/g)) {
  const script = first === 'run' ? second : first;
  if (!script || PNPM_BUILTINS.has(script) || /^\d/.test(script)) continue;
  if (!scripts.has(script)) problems.push(`AGENTS.md: package.json에 없는 스크립트 pnpm ${script}`);
}

if (problems.length > 0) {
  console.error(
    `스킬 · 지침 검사 실패 (${problems.length}):\n${problems.map((p) => `  - ${p}`).join('\n')}`,
  );
  process.exit(1);
}
console.log('스킬 · 지침 검사 통과');
