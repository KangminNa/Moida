import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import rehypeStringify from 'rehype-stringify';
import remarkCjkFriendly from 'remark-cjk-friendly';
import remarkDirective from 'remark-directive';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { unified } from 'unified';

// 블로그 글 본문(md) → HTML. 방문자의 글 페이지(서버)와 편집기의 미리 보기(브라우저)가 같은 것을 쓴다.
// 글 문법 (기획서 2026-10-03, 네이버 블로그식 본문):
//   ::: center … :::   가운데 정렬 블록
//   > [!quote]         큰 인용 (옵시디언 callout과 같은 모양)
//   그 밖은 일반 md + GFM(표·취소선·체크 목록). 한글 옆 굵게·기울임("**중요.**이다")도 먹게 cjk-friendly. 문단 안의 줄바꿈(엔터 한 번)도 줄을 바꾼다 (블로그 글쓰기 습관)
//   사진은 일반 md: ![설명](/api/files/<해시>). 거르기가 http·https와 이 사이트 안의 주소만 남긴다 (javascript:·data: 는 지운다)
// 갤러리(::: gallery)·영상(::youtube{…})·링크 카드(::link{…})는 뒤 단계에서 더한다.
// 본문에 쓴 HTML은 그리지 않고(remark-rehype 기본), 결과도 한 번 더 거른다(rehype-sanitize).
// 바깥 주소(http · https) 링크는 거른 뒤에 새 탭 · rel="noopener noreferrer"를 붙인다 (웹 UX U3). 사이트 안 주소는 같은 탭.

/** md 문법 나무의 마디 (remark가 만드는 모양 중 여기서 보는 것만) */
type MdNode = {
  type: string;
  name?: string;
  value?: string;
  attributes?: Record<string, string | null | undefined> | null;
  children?: MdNode[];
  data?: { hName?: string; hProperties?: Record<string, unknown> };
};

const QUOTE = /^\[!quote\][ \t]*\n?/i;

/** 마디 안의 글자만 (지시문을 글자로 되돌릴 때) */
function textOf(node: MdNode): string {
  return node.value ?? (node.children ?? []).map(textOf).join('');
}

/** 아직 그리지 않는 지시문은 쓴 글자 그대로 남긴다 (예: "Note:hello"의 ":hello"가 사라지지 않게) */
function asText(node: MdNode, colons: string): MdNode {
  const label = node.children?.length ? `[${textOf(node)}]` : '';
  const attrs = Object.entries(node.attributes ?? {})
    .map(([k, v]) => (v ? `${k}=${v}` : k))
    .join(' ');
  return { type: 'text', value: `${colons}${node.name ?? ''}${label}${attrs ? `{${attrs}}` : ''}` };
}

/** 글자 안의 줄바꿈을 줄바꿈 마디로 (코드는 글자 마디가 아니라 그대로) */
function breakLines(node: MdNode): MdNode[] {
  if (node.type !== 'text' || !node.value?.includes('\n')) return [node];
  const out: MdNode[] = [];
  node.value.split('\n').forEach((line, i) => {
    if (i > 0) out.push({ type: 'break' });
    if (line) out.push({ type: 'text', value: line });
  });
  return out;
}

/** Cairn 글 문법을 HTML 모양으로 */
function cairnBlocks() {
  const walk = (node: MdNode): MdNode => {
    if (node.type === 'textDirective') return asText(node, ':');
    if (node.type === 'leafDirective') return { type: 'paragraph', children: [asText(node, '::')] };
    if (node.type === 'containerDirective') {
      node.data = {
        hName: 'div',
        hProperties: node.name === 'center' ? { className: ['md-center'] } : {},
      };
    }
    if (node.type === 'blockquote') {
      const first = node.children?.[0]?.children?.[0];
      if (first?.type === 'text' && first.value && QUOTE.test(first.value)) {
        first.value = first.value.replace(QUOTE, '');
        node.data = { hProperties: { className: ['md-quote'] } };
      }
    }
    if (node.children) node.children = node.children.flatMap(breakLines).map(walk);
    return node;
  };
  return (tree: MdNode) => {
    walk(tree);
  };
}

/** HTML 나무의 마디 (rehype가 만드는 모양 중 여기서 보는 것만) */
type HtmlNode = {
  type: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HtmlNode[];
};

/**
 * 바깥 주소(http · https) 링크는 새 탭으로 (웹 UX U3). 연 쪽 창을 건드리지 못하고 주소가 Referer로 새지 않게.
 * ugc: 회원이 쓴 글(커뮤니티, 스토어 3-2)이면 검색 엔진이 따라가지 않게 nofollow ugc를 더한다 (스팸 링크의 이득을 없앤다)
 */
function externalLinks(ugc: boolean) {
  const walk = (node: HtmlNode): void => {
    const href = node.tagName === 'a' ? node.properties?.href : undefined;
    if (typeof href === 'string' && /^https?:\/\//i.test(href)) {
      node.properties = { ...node.properties, target: '_blank', rel: 'noopener noreferrer' };
      if (ugc) node.properties.rel = `nofollow ugc ${node.properties.rel}`;
    }
    node.children?.forEach(walk);
  };
  return () => (tree: HtmlNode) => {
    walk(tree);
  };
}

/** 기본 거르기 + Cairn 블록의 class 두 개만 더 허락 */
const schema: typeof defaultSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    div: [...(defaultSchema.attributes?.div ?? []), ['className', 'md-center']],
    blockquote: [...(defaultSchema.attributes?.blockquote ?? []), ['className', 'md-quote']],
  },
};

const processorOf = (ugc: boolean) =>
  unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkCjkFriendly)
    .use(remarkDirective)
    .use(cairnBlocks)
    .use(remarkRehype)
    .use(rehypeSanitize, schema)
    .use(externalLinks(ugc))
    .use(rehypeStringify);

const processor = processorOf(false);
const ugcProcessor = processorOf(true);

/** "::: center"처럼 콜론 뒤에 빈칸을 둔 블록도 받는다 (remark-directive는 ":::center"만 읽는다) */
const SPACED_FENCE = /^([ \t]{0,3}:{3,})[ \t]+(?=[a-z])/gim;

/** ugc: 회원이 쓴 글 (커뮤니티). 바깥 링크에 nofollow ugc를 더한다 */
export function renderMarkdown(md: string, { ugc = false }: { ugc?: boolean } = {}): string {
  return String((ugc ? ugcProcessor : processor).processSync(md.replace(SPACED_FENCE, '$1')));
}
