// 사이트 도구의 입출력 형식 (2026-11-16 MCP 2단계): JSON Schema의 작은 부분만 쓴다.
// type(object · array · string · number · integer · boolean · null) · properties · required · items · enum ·
// maxLength · maxItems · description · additionalProperties(false만). 라이브러리 없이 이 부분만 본다.
// 형식은 AI가 쓴 값이라 형식 자체도 검사한다 (깊이 · 칸 수 · 크기 · 모르는 낱말)

type Node = Record<string, unknown>;

const TYPES = ['object', 'array', 'string', 'number', 'integer', 'boolean', 'null'];
const WORDS = [
  'type',
  'properties',
  'required',
  'items',
  'enum',
  'maxLength',
  'maxItems',
  'description',
  'additionalProperties',
];

export class Shape {
  /** 형식 하나의 크기 (글자) */
  static readonly SCHEMA_MAX = 8000;
  private static readonly DEPTH_MAX = 6;
  private static readonly PROPERTIES_MAX = 30;
  private static readonly ENUM_MAX = 50;

  /** 형식이 이 부분만 쓰는가. 틀리면 까닭, 맞으면 null. 맨 위는 object여야 한다 */
  static schemaProblem(schema: unknown): string | null {
    if (JSON.stringify(schema ?? null).length > Shape.SCHEMA_MAX)
      return `형식은 ${Shape.SCHEMA_MAX}자까지예요`;
    const top = Shape.node(schema);
    if (top?.type !== 'object') return '맨 위 형식은 type: object여야 해요';
    return Shape.check(top, '$', 0);
  }

  /** 값이 형식에 맞는가. 틀리면 첫 까닭(어느 칸인지), 맞으면 null */
  static valueProblem(schema: unknown, value: unknown, path = '$'): string | null {
    const node = Shape.node(schema);
    if (!node) return `${path}: 형식이 없어요`;
    const type = String(node.type);
    if (!Shape.typed(type, value)) return `${path}: ${type}이어야 해요`;
    if (Array.isArray(node.enum) && !node.enum.some((e) => Object.is(e, value)))
      return `${path}: 정해진 값이 아니에요`;
    if (
      typeof value === 'string' &&
      typeof node.maxLength === 'number' &&
      value.length > node.maxLength
    )
      return `${path}: ${node.maxLength}자까지예요`;
    if (Array.isArray(value)) {
      if (typeof node.maxItems === 'number' && value.length > node.maxItems)
        return `${path}: ${node.maxItems}개까지예요`;
      for (const [i, item] of value.entries()) {
        const problem = node.items ? Shape.valueProblem(node.items, item, `${path}[${i}]`) : null;
        if (problem) return problem;
      }
    }
    if (type === 'object') return Shape.objectProblem(node, value as Node, path);
    return null;
  }

  private static objectProblem(node: Node, value: Node, path: string): string | null {
    const properties = (Shape.node(node.properties) ?? {}) as Record<string, unknown>;
    const required = Array.isArray(node.required) ? (node.required as string[]) : [];
    for (const name of required)
      if (value[name] === undefined) return `${path}.${name}: 꼭 있어야 해요`;
    for (const [name, item] of Object.entries(value)) {
      const spec = properties[name];
      if (spec === undefined) {
        if (node.additionalProperties === false) return `${path}.${name}: 모르는 칸이에요`;
        continue;
      }
      const problem = Shape.valueProblem(spec, item, `${path}.${name}`);
      if (problem) return problem;
    }
    return null;
  }

  private static check(node: Node, path: string, depth: number): string | null {
    if (depth > Shape.DEPTH_MAX) return `${path}: 형식이 너무 깊어요 (${Shape.DEPTH_MAX}단까지)`;
    const unknown = Object.keys(node).filter((k) => !WORDS.includes(k));
    if (unknown.length > 0) return `${path}: 쓰지 않는 낱말이에요 (${unknown.join(', ')})`;
    if (!TYPES.includes(String(node.type)))
      return `${path}: type이 ${TYPES.join(' · ')} 중 하나여야 해요`;
    if (node.additionalProperties !== undefined && node.additionalProperties !== false)
      return `${path}: additionalProperties는 false만 써요`;
    if (node.enum !== undefined && (!Array.isArray(node.enum) || node.enum.length > Shape.ENUM_MAX))
      return `${path}: enum은 ${Shape.ENUM_MAX}개까지의 목록이에요`;
    for (const word of ['maxLength', 'maxItems'])
      if (node[word] !== undefined && !(Number.isInteger(node[word]) && Number(node[word]) >= 0))
        return `${path}: ${word}는 0 이상의 정수예요`;
    if (node.type === 'array') {
      const items = Shape.node(node.items);
      if (!items) return `${path}: array에는 items가 있어야 해요`;
      return Shape.check(items, `${path}[]`, depth + 1);
    }
    if (node.type === 'object') return Shape.checkObject(node, path, depth);
    return null;
  }

  private static checkObject(node: Node, path: string, depth: number): string | null {
    const properties = node.properties === undefined ? {} : Shape.node(node.properties);
    if (!properties) return `${path}: properties는 객체예요`;
    const names = Object.keys(properties);
    if (names.length > Shape.PROPERTIES_MAX)
      return `${path}: 칸은 ${Shape.PROPERTIES_MAX}개까지예요`;
    const required = node.required ?? [];
    if (!Array.isArray(required) || required.some((r) => !names.includes(String(r))))
      return `${path}: required는 properties에 있는 이름이에요`;
    for (const name of names) {
      const child = Shape.node(properties[name]);
      if (!child) return `${path}.${name}: 형식이 객체가 아니에요`;
      const problem = Shape.check(child, `${path}.${name}`, depth + 1);
      if (problem) return problem;
    }
    return null;
  }

  private static typed(type: string, value: unknown): boolean {
    switch (type) {
      case 'object':
        return typeof value === 'object' && value !== null && !Array.isArray(value);
      case 'array':
        return Array.isArray(value);
      case 'integer':
        return Number.isInteger(value);
      case 'number':
        return typeof value === 'number' && Number.isFinite(value);
      case 'null':
        return value === null;
      default:
        return typeof value === type;
    }
  }

  private static node(value: unknown): Node | null {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Node)
      : null;
  }
}
