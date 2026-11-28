import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { CodexCli } from './codex-cli';
import { Job } from './job';
import { JobPhotos } from './job-photos';
import { JobWorkspace } from './job-workspace';
import { Json } from './json';
import { ToolRefused } from './mcp-client';
import type { MoidaServer } from './moida-server';
import type { RunEvent } from './progress';
import { REPO_PROMPTS } from './testing/repo-prompts';

// 대화에 넣은 사진 받기 (대화에 사진 넣기 ②-b): 참조의 사진을 photos/에 받고, 지시문의 사진 줄과 Codex의 --image를 정한다.
// 서버는 이 테스트의 작은 HTTP 서버와 begin_download 흉내다.

const id = (n: number) => `0190a000-0000-7000-8000-00000000000${n}`;
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('사진 하나'),
]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('사진 둘')]);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>');
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

/** 결과물 id마다 내줄 것: 본문(크기는 표에 적은 값), 또는 begin_download의 거절 */
type Served = { body: Buffer; size?: number } | Error;
let http: Server;
let url: string;
const bodies = new Map<string, Buffer>();

function serverWith(files: ReadonlyMap<string, Served>, asked: string[] = []): MoidaServer {
  return {
    async beginDownload(_task: string, outputId: string) {
      asked.push(outputId);
      const file = files.get(outputId);
      if (file === undefined || file instanceof Error) throw file ?? new Error('없음');
      bodies.set(outputId, file.body);
      return {
        path: '/api/outputs/download',
        header: 'x-moida-download',
        token: outputId,
        name: '서버의 이름.png',
        size: file.size ?? file.body.length,
        sha256: sha(file.body),
      };
    },
  } as unknown as MoidaServer;
}

before(async () => {
  http = createServer((req, res) => {
    const body = bodies.get(String(req.headers['x-moida-download']));
    if (body === undefined) return res.writeHead(403).end();
    res.writeHead(200).end(body);
  });
  await new Promise<void>((done) => http.listen(0, '127.0.0.1', done));
  url = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
});

after(() => http.close());

const chatJob = (refs: object[], kind = 'general', tool = 'claude'): Job =>
  Job.from(
    Json.of({
      task: { id: 'task-1', kind, title: '사진 보기', payload: { refs } },
      instruction: '이 사진 봐 줘',
      agent: { name: '대표', role: '', tool },
      run_token: 'run-token',
    }),
  );
const photo = (n: number, title: string) => ({ kind: 'output', id: id(n), title, image: true });

/** 받기 한 번: 실행 기록 · 작업 자리 · 받은 사진을 실은 일. 자리는 끝나면 지운다 */
async function received(
  job: Job,
  files: ReadonlyMap<string, Served>,
  sight: 'read' | 'attach' | null,
  check: (got: { job: Job; notes: string[]; workspace: JobWorkspace }) => Promise<void>,
  signal = new AbortController().signal,
): Promise<void> {
  const workspace = await JobWorkspace.open(null, null, null, '');
  try {
    const notes: string[] = [];
    const photos = new JobPhotos(job, serverWith(files), url, sight);
    await photos.receive(workspace, signal, (e: RunEvent) => notes.push(e.body));
    await check({ job: photos.onto(job), notes, workspace });
  } finally {
    await workspace.remove();
  }
}

describe('사진 받기', () => {
  test('사진을 photos/에 photo-<n>.<형식>으로 받고, Claude에게는 그 경로를 읽게 한다', async () => {
    const job = chatJob([
      photo(1, '영수증.png'),
      { kind: 'output', id: id(2), title: '메모.csv' },
      photo(3, '풍경'),
    ]);
    const files = new Map<string, Served>([
      [id(1), { body: PNG }],
      [id(3), { body: JPEG }],
    ]);
    await received(job, files, 'read', async ({ job, notes, workspace }) => {
      const dir = join(workspace.workDir, JobPhotos.FOLDER);
      assert.deepEqual((await readdir(dir)).sort(), ['photo-1.png', 'photo-2.jpg']);
      assert.deepEqual(await readFile(join(dir, 'photo-2.jpg')), JPEG);
      const prompt = job.prompt(REPO_PROMPTS, false);
      assert.ok(
        prompt.includes(`영수증.png: 사진 · ${join(dir, 'photo-1.png')}에 받아 두었습니다`),
      );
      assert.ok(prompt.includes(`풍경: 사진 · ${join(dir, 'photo-2.jpg')}에 받아 두었습니다`));
      assert.match(prompt, /메모\.csv: 결과물 파일 \(id .*\) · 이 일에서는 열 수 없습니다/);
      assert.deepEqual(job.refs.attachedPhotos, [], 'Claude는 붙이지 않는다');
      assert.deepEqual(notes, ['사진 2장을 받아요', '사진 2장을 받았어요']);
      // 다시 맡긴 실행(지시만 바꾼 같은 일)에도 사진이 남는다
      assert.ok(job.withInstruction('고쳐 줘').prompt(REPO_PROMPTS, false).includes('photo-1.png'));
    });
  });

  test('Codex에는 --image로 붙인다: 값은 작업 폴더 안의 경로, 지시문에는 몇 번째 그림인지', async () => {
    const job = chatJob([photo(1, '앞'), photo(2, '뒤')], 'general', 'codex');
    const files = new Map<string, Served>([
      [id(1), { body: PNG }],
      [id(2), { body: JPEG }],
    ]);
    await received(job, files, 'attach', async ({ job, workspace }) => {
      const args = new CodexCli('codex', '{}', '', '').args(workspace, job.refs.attachedPhotos);
      assert.deepEqual(args.slice(0, 6), [
        'exec',
        '--image',
        'photos/photo-1.png',
        '--image',
        'photos/photo-2.jpg',
        '--json',
      ]);
      assert.equal(args.at(-1), '-', '지시문은 그대로 표준 입력으로');
      const prompt = job.prompt(REPO_PROMPTS, false);
      assert.ok(prompt.includes('앞: 사진 · 이 지시에 붙인 그림 1번입니다'));
      assert.ok(prompt.includes('뒤: 사진 · 이 지시에 붙인 그림 2번입니다'));
    });
  });

  test('10MB가 넘거나 · 사진이 아니거나 · 없어진 결과물은 받지 못한 사진으로 적고 이어 간다', async () => {
    const job = chatJob([
      photo(1, '큰 사진'),
      photo(2, '도형'),
      photo(3, '지운 사진'),
      photo(4, '됨'),
    ]);
    const files = new Map<string, Served>([
      [id(1), { body: PNG, size: JobPhotos.MAX_BYTES + 1 }],
      [id(2), { body: SVG }],
      [id(3), new ToolRefused('not_found', '없거나 휴지통에 있는 결과물이에요')],
      [id(4), { body: PNG }],
    ]);
    await received(job, files, 'read', async ({ job, notes, workspace }) => {
      const dir = join(workspace.workDir, JobPhotos.FOLDER);
      assert.deepEqual(await readdir(dir), ['photo-4.png'], '받지 못한 파일은 남기지 않는다');
      assert.deepEqual(notes, [
        '사진 4장을 받아요',
        '사진을 받지 못했어요 (큰 사진): 10MB가 넘는 파일이에요',
        '사진을 받지 못했어요 (도형): PNG · JPEG · GIF · WebP가 아니에요',
        '사진을 받지 못했어요 (지운 사진): 없거나 휴지통에 있는 결과물이에요',
        '사진 1장을 받았어요',
      ]);
      const prompt = job.prompt(REPO_PROMPTS, false);
      for (const n of [1, 2, 3])
        assert.ok(prompt.includes(`사진 (id ${id(n)}) · 받지 못해 볼 수 없습니다`), `${n}`);
      assert.ok(prompt.includes(`됨: 사진 · ${join(dir, 'photo-4.png')}에`));
    });
  });

  test('칸의 일은 받지 않는다: 만들기는 inputs/의 재료로, 코드 작업은 이름만', async () => {
    for (const kind of ['make', 'code']) {
      const asked: string[] = [];
      const job = chatJob([photo(1, '사진')], kind);
      const workspace = await JobWorkspace.open(null, null, null, '');
      try {
        const photos = new JobPhotos(job, serverWith(new Map(), asked), url, 'read');
        await photos.receive(workspace, new AbortController().signal, () => {});
        assert.equal(photos.onto(job), job, kind);
        assert.deepEqual(asked, [], `${kind}: 서버에 묻지 않는다`);
      } finally {
        await workspace.remove();
      }
    }
    assert.match(chatJob([photo(1, '사진')], 'make').prompt(REPO_PROMPTS, false), /inputs\//);
  });

  test('사진을 보지 못하는 엔진이면 받지 않고 모두 받지 못한 사진으로 적는다', async () => {
    const asked: string[] = [];
    const job = chatJob([photo(1, '사진')]);
    const workspace = await JobWorkspace.open(null, null, null, '');
    try {
      const notes: string[] = [];
      const photos = new JobPhotos(job, serverWith(new Map(), asked), url, null);
      await photos.receive(workspace, new AbortController().signal, (e) => notes.push(e.body));
      assert.deepEqual(asked, []);
      assert.deepEqual(notes, ['이 AI 도구는 사진을 보지 못해요']);
      assert.match(photos.onto(job).prompt(REPO_PROMPTS, false), /받지 못해 볼 수 없습니다/);
    } finally {
      await workspace.remove();
    }
  });

  test('멈추면 그 자리에서 그만두고 일을 바꾸지 않는다', async () => {
    const stop = new AbortController();
    stop.abort();
    const job = chatJob([photo(1, '사진')]);
    await received(
      job,
      new Map([[id(1), { body: PNG }]]),
      'read',
      async ({ job: after }) => assert.equal(after, job),
      stop.signal,
    );
  });

  test('앞부분으로 형식을 본다 (서버의 FileSniff와 같은 표시)', () => {
    assert.equal(JobPhotos.formatOf(PNG), 'png');
    assert.equal(JobPhotos.formatOf(JPEG), 'jpg');
    assert.equal(JobPhotos.formatOf(Buffer.from('GIF89a......')), 'gif');
    assert.equal(JobPhotos.formatOf(Buffer.from('RIFF\0\0\0\0WEBPVP8 ')), 'webp');
    assert.equal(JobPhotos.formatOf(SVG), null);
    assert.equal(JobPhotos.formatOf(Buffer.alloc(0)), null);
  });
});
