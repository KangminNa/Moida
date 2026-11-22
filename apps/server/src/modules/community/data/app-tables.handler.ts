import { Injectable } from '@nestjs/common';
import { BaseHandler, type DomainEvent, SystemActor } from '../../platform';
import { TablesShownInput } from './app-data.input';
import { AppDataService } from './app-data.service';

// 앱의 보이는 버전이 바뀌면 (blog.app_code.shown) 그 버전이 선언한 표에 맞춘다 (스토어 12.4).
// 선언은 이벤트에 실려 온다: blog의 코드를 읽지 않는다. 두 번 받아도 같은 모양이 된다
@Injectable()
export class AppTablesHandler extends BaseHandler {
  static readonly TOPIC = 'blog.app_code.shown';

  constructor(private readonly data: AppDataService) {
    super();
  }

  async handle(event: DomainEvent): Promise<void> {
    await this.data.apply(new SystemActor(), TablesShownInput.from(event.data));
  }
}
