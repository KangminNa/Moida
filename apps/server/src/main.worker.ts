import 'reflect-metadata';
import { CairnApp } from './cairn-app';

// 일꾼 진입점: HTTP를 열지 않고 이벤트 넘기기와 반복 · 마감 작업만 한다 (시작은 CairnApp)
void CairnApp.worker();
