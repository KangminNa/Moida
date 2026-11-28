import 'reflect-metadata';
import { MoidaApp } from './moida-app';

// 일꾼 진입점: HTTP를 열지 않고 이벤트 넘기기와 반복 · 마감 작업만 한다 (시작은 MoidaApp)
void MoidaApp.worker();
