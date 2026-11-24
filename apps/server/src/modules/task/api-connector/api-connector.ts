import {
  BaseEntity,
  type ColumnRules,
  DomainEvent,
  RuleViolation,
  SealedSecret,
  type SecretBox,
  TableEntity,
  type Unchecked,
} from '../../platform';
import type { ApiConnectorNew, ApiConnectorRow } from '../task.tables';
import { ApiConnectorView, ApiToolView, ProposedApiView } from './api-connector.view';
import { ApiSpec } from './api-spec.policy';

/** 어디서 찾았는지 (propose_api의 source): 레지스트리 · 서비스 문서 · OpenAPI · 직접 */
export type ApiSource = { kind: string; url: string | null };

// API 커넥터 하나 (task.api_connectors, 2026-11-24 기획서 결정 "도구를 찾아 붙이기"): 원격 MCP가 없는 서비스의 REST API를
// 일꾼이 쓴 정의서(ApiSpec)로 붙인다. 새 커넥터는 제안(proposed)으로 두고 결재(task.api.plug)가 승인되면 켠다.
// 켜진 커넥터를 고치는 제안은 pending_spec에 두고 승인되면 앞 정의서를 history에 쌓고 바꾼다 (앞 버전을 남긴다).
// 키(정의서의 머리글마다 값)는 관리자가 콘솔에서 넣고 서버 키로 잠근다. 부를 때 서버 안에서만 풀고 AI · 화면 · 로그에 내지 않는다.
// 기본 주소의 출처가 바뀌는 새 버전은 키를 지운다 (키가 다른 곳으로 가지 않게)
export class ApiConnector extends TableEntity<ApiConnectorRow, ApiConnectorNew> {
  /** 커넥터를 붙이거나 정의서를 바꾸는 결재 */
  static readonly PLUG = 'task.api.plug';
  static readonly TARGET = 'api_connector';
  static readonly ACTIVE = 'active';
  static readonly PROPOSED = 'proposed';
  static readonly OFF = 'off';
  static readonly HISTORY_MAX = 10;
  static readonly NOTE_MAX = 1000;
  private static readonly NAME = /^[a-z][a-z0-9-]{1,29}$/;
  private static readonly SOURCES = ['registry', 'docs', 'openapi', 'manual'];
  private static readonly SECRET_MAX = 4000;

  private static readonly RULES: ColumnRules<ApiConnectorRow> = {
    title: (value) => {
      const title = value.trim();
      if (title.length < 1 || title.length > 60) throw new RuleViolation('이름표는 1~60자예요');
      return title;
    },
    daily_max: (value) => {
      const n = Number(value);
      if (!Number.isInteger(n) || n < 0 || n > 1000)
        throw new RuleViolation('하루 한도는 0~1000번이에요');
      return n;
    },
    note: (value) => {
      if (value.length > ApiConnector.NOTE_MAX)
        throw new RuleViolation(`까닭은 ${ApiConnector.NOTE_MAX}자까지예요`);
      return value;
    },
  };

  /** 일꾼의 제안: 결재를 기다린다. 키는 받지 않는다 */
  static propose(
    spaceId: string,
    agentId: string,
    fields: { name: string; title: string; note: string; source: ApiSource },
    spec: ApiSpec,
    now: Date,
  ): ApiConnector {
    if (!ApiConnector.NAME.test(fields.name))
      throw new RuleViolation('이름은 영문 소문자로 시작하는 소문자 · 숫자 · - 30자까지예요');
    const connector = new ApiConnector(
      {
        id: BaseEntity.newId(),
        space_id: spaceId,
        name: fields.name,
        title: '',
        base: spec.base,
        spec: spec.json(),
        status: ApiConnector.PROPOSED,
        source: ApiConnector.sourceOf(fields.source),
        proposed_by: agentId,
        created_at: now,
        updated_at: now,
      },
      true,
    );
    connector.accept({ title: fields.title, note: fields.note }, ApiConnector.RULES);
    return connector;
  }

  static restore(row: ApiConnectorRow): ApiConnector {
    return new ApiConnector(row);
  }

  get spaceId(): string {
    return this.row.space_id;
  }

  get name(): string {
    return this.row.name;
  }

  get proposed(): boolean {
    return this.row.status === ApiConnector.PROPOSED;
  }

  get dailyMax(): number {
    return this.row.daily_max;
  }

  /** 지금 쓰는 정의서 */
  spec(): ApiSpec {
    return ApiSpec.from(this.row.spec);
  }

  /** 부를 수 있는가: 켜져 있고 머리글마다 키가 있다 */
  assertReady(box: SecretBox): void {
    if (this.row.status !== ApiConnector.ACTIVE)
      throw new RuleViolation(`${this.row.name}: 켜진 커넥터가 아니에요`);
    const keys = this.keys(box);
    for (const h of this.spec().headers)
      if (!keys[h.name])
        throw new RuleViolation(
          `${this.row.name}: 키가 아직 없어요. 관리자에게 콘솔의 커넥터 화면에서 키를 넣어 달라고 하세요`,
        );
  }

  /** 켜진 커넥터를 고치는 제안 (새 버전): 결재를 기다린다. 제안 중인 커넥터면 정의서를 바로 바꾼다 */
  proposeRevision(spec: ApiSpec, note: string, now: Date): void {
    if (this.proposed) {
      this.put('spec', spec.json());
      this.put('base', spec.base);
    } else this.put('pending_spec', spec.json());
    this.accept({ note }, ApiConnector.RULES);
    this.put('updated_at', now);
  }

  /** 결재(task.api.plug)가 승인됐다: 새 커넥터를 켜거나 새 버전으로 바꾼다. 결과를 이벤트로 */
  plugApproved(approvalId: string, targetVersion: number | null, now: Date): DomainEvent {
    if (targetVersion !== null && targetVersion !== this.version)
      return ApiConnector.failed(
        this.row.space_id,
        this.id,
        approvalId,
        `승인 요청 뒤 바뀐 제안이라 반영하지 않았어요 (요청 때 버전 ${targetVersion}, 지금 ${this.version})`,
      );
    if (this.proposed) this.put('status', ApiConnector.ACTIVE);
    else if (this.row.pending_spec) {
      const next = ApiSpec.from(this.row.pending_spec);
      if (new URL(next.base).origin !== new URL(this.row.base).origin) this.clearSecret();
      const history = Array.isArray(this.row.history) ? this.row.history : [];
      this.put('history', [this.row.spec, ...history].slice(0, ApiConnector.HISTORY_MAX));
      this.put('spec', next.json());
      this.put('base', next.base);
      this.put('pending_spec', null);
    } else
      return ApiConnector.failed(this.row.space_id, this.id, approvalId, '반영할 제안이 없어요');
    this.put('updated_at', now);
    return new DomainEvent('task.api_connector.plugged', 1, this.row.space_id, {
      connectorId: this.id,
      approvalId,
      outcome: 'done',
    });
  }

  /** 승인되지 않았다: 새 커넥터의 제안이면 지울 것(true), 새 버전이면 그 제안만 버린다 */
  dropProposal(now: Date): boolean {
    if (this.proposed) return true;
    this.put('pending_spec', null);
    this.put('updated_at', now);
    return false;
  }

  static failed(
    spaceId: string,
    connectorId: string,
    approvalId: string,
    error: string,
  ): DomainEvent {
    return new DomainEvent('task.api_connector.plug_failed', 1, spaceId, {
      connectorId,
      approvalId,
      outcome: 'failed',
      error,
    });
  }

  /** 관리자: 이름표 · 하루 한도 · 켜기 · 끄기 */
  edit(changes: Partial<Unchecked<ApiConnectorRow>>, enabled: boolean | null, now: Date): void {
    this.accept(changes, ApiConnector.RULES);
    if (enabled !== null) {
      if (this.proposed) throw new RuleViolation('제안한 커넥터는 승인으로 정해요');
      this.put('status', enabled ? ApiConnector.ACTIVE : ApiConnector.OFF);
    }
    this.put('updated_at', now);
  }

  /** 관리자: 머리글마다 키를 넣는다 (넣은 것만 바꾸고 나머지는 둔다). 값은 한 줄, 정의서에 있는 머리글만 */
  setKeys(values: Readonly<Record<string, string>>, box: SecretBox, now: Date): void {
    const names = this.spec().headers.map((h) => h.name);
    if (names.length === 0) throw new RuleViolation('이 커넥터는 키를 쓰지 않아요');
    for (const [name, value] of Object.entries(values)) {
      if (!names.includes(name)) throw new RuleViolation(`정의서에 없는 머리글이에요: ${name}`);
      if (value.length < 1 || value.length > ApiConnector.SECRET_MAX || /[\r\n]/.test(value))
        throw new RuleViolation(`키는 한 줄, ${ApiConnector.SECRET_MAX}자까지예요`);
    }
    const sealed = box.seal(JSON.stringify({ ...this.keys(box), ...values }));
    this.put('secret', sealed.ciphertext);
    this.put('nonce', sealed.nonce);
    this.put('updated_at', now);
  }

  /** 보낼 때 싣는 머리글 (서버 안에서만 푼다) */
  headers(box: SecretBox): Record<string, string> {
    const keys = this.keys(box);
    return Object.fromEntries(
      this.spec().headers.flatMap((h) =>
        keys[h.name] ? [[h.name, h.value(keys[h.name] ?? '')]] : [],
      ),
    );
  }

  /** 서버 키를 바꾼 뒤 지금 키로 다시 잠근다. 바꿨으면 true */
  reseal(box: SecretBox): boolean {
    const { secret, nonce } = this.row;
    const again = secret && nonce ? box.reseal(new SealedSecret(secret, nonce)) : null;
    if (!again) return false;
    this.put('secret', again.ciphertext);
    this.put('nonce', again.nonce);
    return true;
  }

  view(box: SecretBox, spent: number): ApiConnectorView {
    const keys = this.keys(box);
    return new ApiConnectorView(
      this.row,
      this.spec().headers.map((h) => ({ name: h.name, set: !!keys[h.name] })),
      spent,
    );
  }

  /** 일꾼에게 보이는 한 줄 (api_tools): 키가 있는지 · 남은 횟수 */
  toolView(box: SecretBox, spent: number): ApiToolView {
    let ready = true;
    try {
      this.assertReady(box);
    } catch {
      ready = false;
    }
    return new ApiToolView(
      this.row,
      this.spec().operations.map((o) => o.json()),
      ready,
      spent,
    );
  }

  /** propose_api의 답 */
  proposedView(approvalId: string): ProposedApiView {
    return new ProposedApiView(this.row, approvalId);
  }

  private keys(box: SecretBox): Record<string, string> {
    const { secret, nonce } = this.row;
    if (!secret || !nonce) return {};
    const text = box.open(new SealedSecret(secret, nonce));
    try {
      return text ? (JSON.parse(text) as Record<string, string>) : {};
    } catch {
      return {};
    }
  }

  private clearSecret(): void {
    this.put('secret', null);
    this.put('nonce', null);
  }

  private static sourceOf(source: ApiSource): ApiSource {
    if (!ApiConnector.SOURCES.includes(source.kind))
      throw new RuleViolation(`source.kind: ${ApiConnector.SOURCES.join(' · ')} 중 하나예요`);
    if (source.url !== null && (!/^https:\/\//.test(source.url) || source.url.length > 500))
      throw new RuleViolation('source.url: 500자까지의 https 주소예요');
    return { kind: source.kind, url: source.url };
  }
}
