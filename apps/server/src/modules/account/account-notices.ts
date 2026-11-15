import { Injectable, type OnModuleInit } from '@nestjs/common';
import { NoticeCatalog, NoticeKind } from '../platform';

// account가 알리는 것 (7단계): 새 기기 연결(즉시). 모르는 기기가 붙었으면 바로 알아야 한다 (기획서 6.2).
// 보안 화면 (2026-11-15): 새 곳에서 로그인(즉시, 최근 90일 로그인한 적 없는 곳), 로그인 막힘(즉시, OwnerService가 바로 남긴다).
@Injectable()
export class AccountNotices implements OnModuleInit {
  static readonly DEVICE_CONNECTED = 'account.device.connected';
  static readonly LOGIN_NEW_PLACE = 'account.login.new_place';
  static readonly LOGIN_BLOCKED = 'account.login.blocked';

  constructor(private readonly catalog: NoticeCatalog) {}

  onModuleInit(): void {
    this.catalog.define(
      new NoticeKind(AccountNotices.DEVICE_CONNECTED, '새 기기 연결', NoticeKind.IMMEDIATE).from(
        ['account.device.connected'],
        (e) => ({
          title: '새 기기를 연결했어요',
          body: [e.data.name, e.data.client]
            .filter((v) => typeof v === 'string' && v !== '')
            .join(' · '),
          link: '/admin/devices',
          group_key: `device:${e.data.deviceId}`,
          data: { deviceId: e.data.deviceId },
        }),
      ),
    );
    this.catalog.define(
      new NoticeKind(AccountNotices.LOGIN_NEW_PLACE, '새 곳에서 로그인', NoticeKind.IMMEDIATE).from(
        ['account.login.succeeded'],
        (e) =>
          e.data.newPlace === true
            ? {
                title: '새 곳에서 로그인했어요',
                body: [e.data.ip, e.data.userAgent]
                  .filter((v) => typeof v === 'string' && v !== '')
                  .join(' · '),
                link: '/admin/security',
                group_key: `login:${e.data.sessionId ?? ''}`,
                data: {},
              }
            : null,
      ),
    );
    // 이벤트 없이 OwnerService가 남긴다 (틀린 로그인은 저장할 엔티티가 없다). 설정 화면에 보이게 종류만 등록
    this.catalog.define(
      new NoticeKind(AccountNotices.LOGIN_BLOCKED, '로그인 막힘', NoticeKind.IMMEDIATE),
    );
  }
}
