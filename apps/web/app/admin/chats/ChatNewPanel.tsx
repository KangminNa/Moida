'use client';

import { useRouter } from 'next/navigation';
import { useRef } from 'react';
import { useMe } from '../../_account/live';
import { api, uploadFile } from '../../_lib/client-api';
import { SHRINK, shrinkImage } from '../../_lib/image-shrink';
import { useAction } from '../../_lib/use-action';
import type { Chat, OutputSaved } from '../../_task/types';
import { ChatForm, type ChatMessageBody } from './ChatForm';
import type { RefChoice } from './ChatRefs';
import { PHOTO_TYPES } from './chat-photos';

// 새 대화 (2차 1-5, 처음 화면): 인사와 입력 하나. 상대 · 프로젝트 · 받을 것은 고르지 않는다:
// 대표가 받아 일꾼에게 나눠 맡긴다 (O-2). 보내면 그 대화로 간다
export function ChatNewPanel() {
  const me = useMe();
  const action = useAction();
  const uploading = useAction();
  const router = useRouter();
  /** 응답을 못 받아 다시 보내도 대화가 하나만 생기게 */
  const requestId = useRef('');
  if (!requestId.current) requestId.current = crypto.randomUUID();
  const name = me.data?.name;

  /** 파일을 올려 결과물로 만들고 참조로 넣는다 (올린 파일은 보관함의 결과물이 된다) */
  async function upload(picked: File): Promise<RefChoice | null> {
    // 사진이면 줄여서 올린다 (긴 변 2048px · WebP, 위치 정보 빠짐). 사진이 아닌 파일은 그대로
    const file = await shrinkImage(picked, SHRINK.photo);
    const reply = await uploading.run('upload', () =>
      uploadFile<OutputSaved>(
        `/api/outputs/files?name=${encodeURIComponent(file.name)}`,
        file,
        'application/octet-stream',
      ),
    );
    if (!reply?.ok) return null;
    return {
      kind: 'output',
      id: reply.data.id,
      title: file.name,
      url: null,
      browser: false,
      // 사진은 서버가 앞부분으로 알아본 그림만 (이름으로 정한 SVG는 아니다)
      image: PHOTO_TYPES.includes(reply.data.mime),
    };
  }

  async function start(body: ChatMessageBody) {
    const reply = await action.run('start', () =>
      api<Chat>('POST', '/api/chats', { requestId: requestId.current, ...body }),
    );
    if (!reply?.ok) return;
    requestId.current = crypto.randomUUID();
    router.push(`/admin/chats/${reply.data.id}`);
  }

  return (
    <section className="chat-home" aria-labelledby="chat-home-title">
      <h1 id="chat-home-title">{name ? `${name}, 무엇을 맡길까요?` : '무엇을 맡길까요?'}</h1>
      <ChatForm
        busy={action.busy !== null}
        problem={action.problem ?? uploading.problem}
        blocked={null}
        hint={null}
        rows={3}
        refsEnabled
        onUpload={upload}
        onSubmit={start}
      />
      <p className="note">
        대표가 받아 일꾼에게 나눠 맡기고 결과를 모아 답해요. + 단추나 @로 위키 · 파일 · 주소를 함께
        넣어요
      </p>
    </section>
  );
}
