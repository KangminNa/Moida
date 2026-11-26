import { isIP } from 'node:net';
import { Injectable } from '@nestjs/common';
import {
  Actor,
  AttemptLimiter,
  BaseService,
  Database,
  Forbidden,
  NotFound,
  NoticeKind,
  Notices,
  PasswordHasher,
  SecurityLog,
  type Sql,
  SystemActor,
  TooManyRequests,
  Unauthenticated,
} from '../../platform';
import { AccountNotices } from '../account-notices';
import { InstallPolicy } from '../space/install.policy';
import { SpaceQuery } from '../space/space.query';
import type { ExternalCallbackInput } from './external-login.input';
import { ExternalLoginQuery } from './external-login.query';
import { Owner, WebSession } from './owner';
import type {
  ChangePasswordInput,
  CreateOwnerInput,
  LoginInput,
  RenameOwnerInput,
  SessionIdInput,
} from './owner.input';
import { OwnerRepository } from './owner.repository';
import { PasswordPolicy } from './password.policy';

// 주인 계정과 로그인: 설치 때 계정 만들기, 아이디·비밀번호 로그인, 로그아웃, 비밀번호 바꾸기·다시 정하기,
// 보안 화면의 로그인 끝내기와 마지막 접근.
// 비밀번호 계산(scrypt)은 느리게 만든 것이라 트랜잭션 밖에서 한다.
// 보안 기록 (2026-11-15): 성공한 일(로그인 · 로그아웃 · 끝내기 · 비밀번호)은 Owner의 사건으로 남고 AccountSecurity가 옮긴다.
// 틀린 · 막힌 로그인은 저장할 엔티티가 없어 여기서 SecurityLog에 바로 남기고, 오류에 표시해 오류 필터가 다시 남기지 않게 한다.
@Injectable()
export class OwnerService extends BaseService {
  private static readonly WRONG = '맞지 않는 메일이나 비밀번호예요';
  /** 틀린 로그인은 한 곳에서 · 한 아이디에 정한 수까지 (맞는 로그인은 세지 않음) */
  private readonly byPlace = new AttemptLimiter(
    WebSession.TRIES_PER_PLACE,
    WebSession.TRY_WINDOW_MS,
  );
  private readonly byLogin = new AttemptLimiter(
    WebSession.TRIES_PER_LOGIN,
    WebSession.TRY_WINDOW_MS,
  );
  /** 이 프로세스가 마지막 접근을 적은 때 (로그인 해시 → ms). 요청마다 쓰지 않게 */
  private readonly touched = new Map<string, number>();
  private static readonly TOUCHED_MAX = 1000;

  constructor(
    db: Database,
    private readonly spaces: SpaceQuery,
    private readonly install: InstallPolicy,
    private readonly passwords: PasswordPolicy,
    private readonly hasher: PasswordHasher,
    private readonly external: ExternalLoginQuery,
  ) {
    super(db);
  }

  /** 설치 통행증을 가진 브라우저만, 아직 주인이 없을 때 한 번. 만든 계정으로 바로 로그인된다 */
  async create(
    actor: Actor,
    pass: string | null,
    req: CreateOwnerInput,
    ip: string,
    userAgent: string,
  ): Promise<WebSession> {
    const spaceId = this.install.assertCanClaim(await this.spaces.installStatus(actor, pass));
    this.passwords.check(req.email, req.password);
    const hash = await this.hasher.hash(req.password);
    return this.transaction(async (tx) => {
      const owners = new OwnerRepository(tx);
      const now = new Date();
      const owner = Owner.create(spaceId, req.email, hash, now);
      const session = owner.startSession(ip, userAgent, now, 'install');
      await owners.save(owner);
      return session;
    });
  }

  async login(req: LoginInput, ip: string, userAgent: string): Promise<WebSession> {
    try {
      this.byPlace.check(AttemptLimiter.place(ip));
      this.byLogin.check(req.login);
    } catch (error) {
      if (!(error instanceof TooManyRequests)) throw error;
      const owner = await new OwnerRepository(this.db.sql).findByLogin(req.login);
      await this.refused('login.blocked', owner, ip, userAgent, 'password');
      throw error.markRecorded();
    }
    const found = await new OwnerRepository(this.db.sql).findByLogin(req.login);
    // 아이디가 없어도 같은 계산을 해서, 응답 시간으로 아이디가 있는지 알 수 없게 한다
    const ok = await this.hasher.verify(req.password, found?.passwordHash ?? null);
    if (!found || !ok) {
      this.byPlace.fail(AttemptLimiter.place(ip));
      this.byLogin.fail(req.login);
      await this.refused('login.failed', found, ip, userAgent, 'password');
      throw new Unauthenticated(OwnerService.WRONG).markRecorded();
    }
    const rehash =
      found.passwordHash && this.hasher.needsRehash(found.passwordHash)
        ? await this.hasher.hash(req.password)
        : null;
    return this.transaction(async (tx) => {
      const owners = new OwnerRepository(tx);
      const owner = (await owners.findByLogin(req.login)) ?? found;
      if (rehash) owner.rehashPassword(rehash);
      const session = owner.startSession(
        ip,
        userAgent,
        new Date(),
        'password',
        await this.knownIps(owners, owner),
      );
      await owners.save(owner);
      return session;
    });
  }

  async logout(actor: Actor, token: string | null, ip = '', userAgent = ''): Promise<void> {
    if (actor.kind !== 'owner' || !token) throw new Unauthenticated('로그인해 주세요');
    await this.transaction(async (tx) => {
      const owners = new OwnerRepository(tx);
      const owner = await owners.findBySession(WebSession.hash(token));
      if (!owner) return;
      owner.endSession(WebSession.hash(token), new Date(), ip, userAgent);
      await owners.save(owner);
    });
  }

  /** 다른 곳의 로그인 하나를 끝낸다 (보안 화면). 지금 로그인은 로그아웃으로 */
  async endSession(actor: Actor, token: string | null, req: SessionIdInput): Promise<void> {
    actor.assertOwner();
    if (!token) throw new Unauthenticated('로그인해 주세요');
    await this.transaction(async (tx) => {
      const owners = new OwnerRepository(tx);
      const owner = await owners.findWithSession(actor.id ?? '', req.id);
      if (!owner) throw new NotFound('없는 로그인이에요');
      owner.endSessionById(req.id, WebSession.hash(token), new Date());
      await owners.save(owner);
    });
  }

  /** 지금 로그인 말고 모두 끝낸다 ("다른 곳 모두 로그아웃") */
  async endOtherSessions(actor: Actor, token: string | null): Promise<void> {
    actor.assertOwner();
    if (!token) throw new Unauthenticated('로그인해 주세요');
    const tokenHash = WebSession.hash(token);
    await this.transaction(async (tx) => {
      const owners = new OwnerRepository(tx);
      const owner = await owners.findBySession(tokenHash);
      const current = owner?.session(tokenHash);
      if (!owner || !current) throw new Unauthenticated('로그인해 주세요');
      owner.endOtherSessions(current);
      await owners.save(owner);
    });
  }

  /**
   * 로그인의 마지막 접근 (Guard가 주인을 알아본 요청마다 부른다). 프로세스마다 WebSession.SEEN_MS에 한 번만 적고
   * version은 올리지 않는다. 주소가 IP 모양이 아니면 시각만. 함께 끝나는 날을 늘린다 (마지막으로 쓴 날부터 30일, 웹 UX U2)
   */
  async seen(token: string, ip: string, now: Date): Promise<void> {
    const tokenHash = WebSession.hash(token);
    if (now.getTime() - (this.touched.get(tokenHash) ?? 0) < WebSession.SEEN_MS) return;
    if (this.touched.size > OwnerService.TOUCHED_MAX) this.touched.clear();
    this.touched.set(tokenHash, now.getTime());
    await this.transaction((tx) =>
      new OwnerRepository(tx).touchSession(tokenHash, isIP(ip) ? ip : null, now),
    );
  }

  /** 지금 비밀번호를 확인하고 바꾼다. 지금 로그인만 남기고 다른 로그인은 끝난다 */
  async changePassword(
    actor: Actor,
    token: string | null,
    req: ChangePasswordInput,
  ): Promise<void> {
    if (actor.kind !== 'owner' || !token) throw new Unauthenticated('로그인해 주세요');
    const tokenHash = WebSession.hash(token);
    const found = await new OwnerRepository(this.db.sql).findBySession(tokenHash);
    if (!found) throw new Unauthenticated('로그인해 주세요');
    this.byLogin.check(found.login);
    if (!(await this.hasher.verify(req.current, found.passwordHash))) {
      this.byLogin.fail(found.login);
      throw new Unauthenticated('지금 비밀번호를 다시 확인해 주세요');
    }
    this.passwords.check(found.login, req.next, 'next');
    const hash = await this.hasher.hash(req.next);
    await this.transaction(async (tx) => {
      const owners = new OwnerRepository(tx);
      const owner = await owners.findBySession(tokenHash);
      if (!owner) throw new Unauthenticated('로그인해 주세요');
      owner.setPassword(hash, owner.session(tokenHash), new Date());
      await owners.save(owner);
    });
  }

  /**
   * 외부 로그인에서 돌아왔을 때. 그 서비스에 누구인지 묻고(트랜잭션 밖),
   *   로그인: 연결해 둔 계정이면 새 로그인 (아니면 403)
   *   연결: 시작한 주인이 지금도 로그인해 있으면 그 주인에게 연결 (새 로그인은 없음 → null)
   */
  async finishExternal(
    actor: Actor,
    req: ExternalCallbackInput,
    ip: string,
    userAgent: string,
  ): Promise<WebSession | null> {
    const method = this.external.method(req.method);
    const identity = await method.login.finish(
      req.query,
      await this.external.callbackUrl(actor, method.name),
    );
    if (req.isLink && (actor.kind !== 'owner' || actor.id !== req.userId))
      throw new Unauthenticated('계정을 연결하려면 로그인해 주세요');
    return this.transaction(async (tx) => {
      const owners = new OwnerRepository(tx);
      if (req.isLink) {
        const owner = await owners.findById(req.userId ?? '');
        if (!owner) throw new Unauthenticated('로그인해 주세요');
        owner.link(method.name, identity.subject, identity.label);
        await owners.save(owner);
        return null;
      }
      const owner = await owners.findByLink(method.name, identity.subject);
      if (!owner) return null;
      const session = owner.startSession(
        ip,
        userAgent,
        new Date(),
        method.name,
        await this.knownIps(owners, owner),
      );
      await owners.save(owner);
      return session;
    }).then(async (session) => {
      if (session || req.isLink) return session;
      await this.refused('login.failed', null, ip, userAgent, method.name);
      throw new Forbidden(
        'owner',
        '연결하지 않은 계정이에요. 비밀번호로 로그인한 뒤 계정 화면에서 먼저 연결해 주세요',
      ).markRecorded();
    });
  }

  /** 연결한 외부 계정을 끊는다. 그 계정으로는 더 로그인되지 않는다 (비밀번호 로그인은 그대로) */
  async unlink(actor: Actor, method: string): Promise<void> {
    actor.assertOwner();
    await this.transaction(async (tx) => {
      const owners = new OwnerRepository(tx);
      const owner = await owners.findById(actor.id ?? '');
      if (!owner) throw new Unauthenticated('로그인해 주세요');
      owner.unlink(method);
      await owners.save(owner);
    });
  }

  /** 화면에 보일 이름 (주인만) */
  async rename(actor: Actor, req: RenameOwnerInput): Promise<Owner> {
    actor.assertOwner();
    return this.transaction(async (tx) => {
      const owners = new OwnerRepository(tx);
      const owner = await owners.findById(actor.id ?? '');
      if (!owner) throw new Unauthenticated('로그인해 주세요');
      owner.rename(req.displayName, req.version);
      await owners.save(owner);
      return owner;
    });
  }

  /** 명령줄(pnpm run owner reset-password): 서버에 접속할 수 있는 사람 = 주인. 모든 로그인이 끝난다 */
  async resetPassword(actor: Actor, plain: string): Promise<Owner> {
    if (!(actor instanceof SystemActor))
      throw new Unauthenticated('비밀번호 다시 정하기는 서버 명령줄에서만 할 수 있어요');
    const found = await new OwnerRepository(this.db.sql).findOnly();
    if (!found) throw new NotFound('관리자 계정부터 만들어 주세요 (설치 마법사)');
    this.passwords.check(found.login, plain);
    const hash = await this.hasher.hash(plain);
    return this.transaction(async (tx) => {
      const owners = new OwnerRepository(tx);
      const owner = (await owners.findOnly()) ?? found;
      owner.setPassword(hash, null, new Date());
      await owners.save(owner);
      return owner;
    });
  }

  /** 최근 로그인한 주소들 (새 곳에서 로그인했는지 보려고) */
  private knownIps(owners: OwnerRepository, owner: Owner): Promise<string[]> {
    const since = new Date(Date.now() - WebSession.KNOWN_DAYS * 86_400_000);
    return owners.recentIps(owner.id, since);
  }

  /**
   * 틀린 · 막힌 로그인을 보안 기록에 남긴다. 아이디는 관리자의 것일 때만 적는다 (비밀번호를 아이디 칸에 잘못 친 글자가 남지 않게).
   * 관리자의 아이디로 막혔으면 알린다 (같은 곳은 1분에 한 번: 기록이 새 줄일 때만)
   */
  private async refused(
    kind: 'login.failed' | 'login.blocked',
    owner: Owner | null,
    ip: string,
    userAgent: string,
    method: string,
  ): Promise<void> {
    await this.transaction(async (tx: Sql) => {
      const fresh = await new SecurityLog(tx).record({
        space_id: owner?.spaceId ?? null,
        kind,
        ip,
        user_agent: userAgent || null,
        detail: { method, login: owner?.login ?? null },
      });
      if (!fresh || kind !== 'login.blocked' || !owner) return;
      await new Notices(tx).post({
        space_id: owner.spaceId,
        kind: AccountNotices.LOGIN_BLOCKED,
        severity: NoticeKind.IMMEDIATE,
        title: '로그인 시도가 몰려 잠시 막았어요',
        body: [ip, owner.login].filter(Boolean).join(' · '),
        link: '/admin/security',
        group_key: `login-blocked:${AttemptLimiter.place(ip)}`,
      });
    });
  }
}
