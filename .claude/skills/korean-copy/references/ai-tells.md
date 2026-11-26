# 한국어 AI 티 패턴

S1: 한 번만 나와도 고친다. S2: 같은 곳(문단 · 카드 묶음 · 한 화면)에서 되풀이될 때만 고친다. 번호는 출처의 분류 번호를 따른다 (빠진 번호는 이 저장소의 문구에 맞지 않아 뺐다).

## A 번역투

| 번호 | 패턴 | 고치는 법 | 단계 |
|---|---|---|---|
| A-1 | "~에 대해(서)" | 목적격으로 바로 ("A에 대해 설명" → "A 설명"). 문단에 세 번 넘게 몰릴 때 | S2 |
| A-2 | "~를 통해" | "~로", "~에서". 되풀이될 때 | S2 |
| A-3 | "~에 있어(서)" | "~에서", "~할 때" | S1 |
| A-5 | "~와 관련하여 / 관련된" | "~에", "~의" | S2 |
| A-6 | "~에 기반하여 / ~을 바탕으로" | "~로", "~을 보고" | S2 |
| A-7 | "가지고 있다", "~를 제공한다"처럼 영어 동사+명사를 옮긴 말 | 형용사 · 동사 하나로 ("기능을 제공해요" → "~해요") | S1 |
| A-8 | 이중 피동 "~되어지다 / ~지게 되다" | 능동이나 피동 하나로 | S1 |
| A-9 | "~에 의해" 피동 | 하는 쪽을 주어로 | S2 |
| A-12 | "만들어지다 / 이루어지다" | 능동이나 단순한 동사로 | S2 |
| A-14 | "그리고"로 문장 잇기 | "-고", "-며"로 줄이기 | S2 |
| A-15 | 추상 주어 + "보여준다 · 제공한다 · 가능하게 한다" | 하는 사람 · 기능을 주어로 | S2 |
| A-16 | 가리킬 것이 없는 "그 · 그것 · 이것" | 이름을 다시 쓰거나 뺀다 | S1 |
| A-19 | 겹친 조사 "-에서의 · -으로의 · -으로부터의" | 풀어 쓴다 | S2 |
| A-21 | "단순한 X를 넘어 Y" | "X만이 아니라 Y", 아니면 Y만 | S2 |
| A-22 | "~은 명확하다 / 분명하다"를 얹기 | 그 내용을 바로 말한다 | S2 |
| A-23 | "발판을 마련하다 · 지평을 열다" | 실제로 하는 일로 | S1 |
| A-24 | "더 이상 ~ 않다" | "이제 ~ 않다" | S2 |

## B 영어 섞기

| 번호 | 패턴 | 고치는 법 | 단계 |
|---|---|---|---|
| B-1 | 괄호 영어를 되풀이 ("승인(approval)") | 처음 한 번만, 화면에서는 빼기 | S2 |
| B-2 | 광고 말(seamless · robust · 원활한 · 손쉽게 · 강력한) | 실제로 하는 일로. 표준 기술 용어는 그대로 | S2 |

## C 구조

| 번호 | 패턴 | 고치는 법 | 단계 |
|---|---|---|---|
| C-1 | 기계적으로 맞춘 나열 (늘 셋, 늘 같은 길이) | 실제 개수대로. 넷 넘게 같은 박자면 몇 개를 문장에 녹인다 | S2 |
| C-2 | 한 덩어리를 불릿으로 잘게 나눔 | 이어지는 말이면 문장으로 | S2 |
| C-5 | 이모지 | 뺀다 (아이콘은 `_ui/Icon.tsx`) | S1 |
| C-6 | 제목 아래 "이 부분에서는 ~를 다뤄요" | 지운다 | S2 |
| C-8 | 대칭 대구 "A는 ~, B는 ~" · "A가 아니라 B" · "A해도 B" 제목이 잇달아 | 한 화면에 하나만 남기고 나머지는 바로 말한다 | S1 |
| C-10 | 콜론 부제 "X: Y" 제목 | 명사구 하나로 | S2 |
| C-11 | 연결어미 뒤 쉼표 ("쌓고, 봐요", "많아도, 하나") | 짧은 문장은 쉼표를 뺀다. 긴 문장은 두 문장으로 나눈다 | S1 |
| C-12 | 문장 절반 넘게 쉼표 | 몇 문장을 짧게 | S2 |

## D AI가 자주 쓰는 말

| 번호 | 패턴 | 고치는 법 | 단계 |
|---|---|---|---|
| D-1 | 정리 말 "결론적으로 · 요약하면 · ~라고 할 수 있어요" | 지운다 | S1 |
| D-2 | 의의 부풀리기 "주목할 만해요 · 큰 의미가 있어요" | 지우거나 구체적인 결과로 | S1 |
| D-3 | 나열 머리말 "크게 세 가지로 나눌 수 있어요" | 지운다 | S1 |
| D-4 | 과장 말 "혁신적 · 획기적 · 완벽한 · 강력한" | 숫자나 사실로 | S1 |
| D-5 | 사물이 사람처럼 하는 말 ("데이터가 말해 줘요") | 하는 사람을 주어로 | S2 |
| D-6 | 끝맺음 공식 "~할 때예요" | 화면 하나에 한 번 | S2 |
| D-7 | "X에서 Y로 · X를 넘어 Y로" | 바로 말한다 | S2 |
| D-8 | "중요한 것은 X예요 · 핵심은 X" | 주어와 서술을 바로 잇는다 | S2 |
| D-9 | "결국 ~로 이어져요" | 무엇이 어떻게 되는지 구체적으로 | S2 |
| D-10 | "~하는 이유예요"로 끝내기 | 앞에서 바로 말한다 | S2 |
| D-11 | 막연한 때 "향후 · 앞으로 · 중장기적으로" | 실제 때나 조건, 모르면 뺀다 (지어내지 않는다) | S2 |
| D-14 | 비유 (엔진 · 칸 · 사다리 · 고리 · 머릿속 · 끼우기) | 그것이 무엇인지 바로. 이 저장소에서는 한 번만 나와도 고친다 | S1 |

## E 리듬

| 번호 | 패턴 | 고치는 법 | 단계 |
|---|---|---|---|
| E-1 | 문장 길이가 다 같다 | 짧은 문장과 긴 문장을 섞는다 | S2 |
| E-2 | 같은 끝맺음이 잇달아 ("~요. ~요. ~요." 카드마다 같은 틀) | 명사로 끝내기 · 다른 어미를 섞는다 | S2 |

## F 꾸밈 · 겹침

| 번호 | 패턴 | 고치는 법 | 단계 |
|---|---|---|---|
| F-1 | 정도 부사 "매우 · 정말 · 아주" | 뺀다 | S2 |
| F-2 | 같은 뜻 두 번 ("빠르고 신속하게") | 하나만 | S2 |
| F-4 | "-적 · -성 · -화"가 많다 | 풀어 쓴다 | S2 |

## H 접속사 · I 형식 명사 · J 꾸밈

| 번호 | 패턴 | 고치는 법 | 단계 |
|---|---|---|---|
| H-1 | 문장 첫머리 "또한 · 따라서 · 즉 · 나아가"가 되풀이 | 몇 개를 지운다 | S2 |
| H-3 | "이는 ~" 시작이 되풀이 | 주어를 바로 쓴다 | S2 |
| I-1 | "~것이에요"로 잇달아 끝냄 | 서술어로 바로 | S2 |
| J-1 | 굵은 글씨가 많다 | 한 화면에 꼭 필요한 것만 | S2 |
| J-2 | 따옴표로 강조 | 뺀다 | S2 |

## 화면 문구에서 더 보는 것 (이 저장소)

- 같은 화면에 같은 문장이 두 번 나오면 하나를 지운다.
- 제목은 명사구나 짧은 문장 하나. 제목마다 같은 틀(대구 · 쉼표)이면 C-8.
- 정하지 않은 용어 · 옛 말(팀 · 팀원 · 팀장 · 판 · 시험 · 결재 · 주인)은 [SKILL.md](../SKILL.md)의 규칙대로.

## 출처와 라이선스

패턴 분류는 im-not-ai(Humanize KR v2.4.8, https://github.com/epoko77-ai/im-not-ai)의
`skills/humanize-korean/references/ai-tell-taxonomy.md`를 참고해 이 저장소에 맞게 줄이고 다시 썼다. 원문의 라이선스:

```
MIT License

Copyright (c) 2026 epoko77-ai

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
