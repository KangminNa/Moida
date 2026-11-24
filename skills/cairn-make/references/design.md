# 디자인 기준 (앱 화면 · 페이지)

앱 화면과 웹 페이지는 이 기준으로 만든다. 디자인을 매번 처음부터 정하지 않는다. **목적에 맞는 스타일 하나를 고르고 → 토큰을 채우고 → 체크리스트를 지킨다.**
러너가 낸 코드를 "디자인 기준" 검사로 본다 (맨 아래). 떨어지면 한 번 더 고칠 기회가 온다.

참고한 것: WCAG 2.2 AA(대비 · 누르는 크기 · 포커스), Radix Colors의 12단계 색 쓰임, Vercel Web Interface Guidelines(입력 · 상태 · 움직임), Anthropic frontend-design 스킬(분위기 하나를 정해 끝까지). 글은 옮기지 않고 우리 말로 다시 썼다.

## 1. 순서

1. 이 앱이 **누구에게 · 무엇을** 하는지 한 줄로 적는다 (예: "동네 손님이 오늘 메뉴와 여는 시간을 본다").
2. 아래 2장의 스타일 중 하나를 고른다. 지시에 분위기 · 색 · 참고 사이트가 있으면 그것이 먼저다 (토큰 값만 바꾼다).
3. 3장의 토큰 이름 그대로 `:root`에 값을 채운다. 어두운 화면 값도 함께 쓴다.
4. 화면을 만든다. 색 · 간격 · 글자 크기 · 모서리는 **토큰만** 쓴다 (`var(--space-4)`). 값을 직접 적지 않는다.
5. 4장 체크리스트를 하나씩 확인한다. 5장의 "AI가 만든 티"가 없는지 본다.

## 2. 스타일 (하나를 고른다)

| 스타일 | 어울리는 앱 | 글꼴 | 모서리 | 밀도 | 색 |
|---|---|---|---|---|---|
| `tool` 도구 | 계산기 · 일정표 · 변환기 · 체크리스트 | 산세리프 | 8px | 촘촘 (기본 간격 12) | 중립 회색 + 파랑 강조 |
| `reading` 읽기 | 소개 · 포트폴리오 · 안내 · 이력서 | 제목 세리프, 본문 산세리프 | 4px | 넉넉 (줄 길이 65자) | 종이색 배경 + 짙은 잉크 + 강조 하나 |
| `data` 대시보드 | 숫자 · 기록 · 순위 · 통계 | 산세리프, 숫자 `tabular-nums` | 8px | 촘촘, 표 중심 | 흰 배경 + 회색 칸 + 강조 하나, 차트는 회색 + 강조 |
| `shop` 가게 · 장소 | 카페 · 식당 · 공방 · 행사 | 산세리프, 제목 굵게 | 12px | 보통 | 따뜻한 바탕 + 대표색 하나(가게 색) |
| `play` 놀이 | 퀴즈 · 게임 · 투표 · 운세 | 산세리프 둥근 굵기 | 16px | 크게 (단추 52px) | 밝은 바탕 + 선명한 강조 둘까지 |
| `board` 게시판 | 커뮤니티 · 방명록 · 질문 모음 | 산세리프 | 8px | 목록 중심 (줄마다 구분선) | 중립 회색 + 강조 하나 |

- 글꼴은 시스템 글꼴만 쓴다. 산세리프: `system-ui, -apple-system, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif`. 세리프: `"Noto Serif KR", "AppleMyungjo", ui-serif, Georgia, serif`. 둥근: 산세리프에 굵기 600~700.
- 강조색은 **하나**가 기본이다 (`play`만 둘까지). 강조는 주 동작(단추 · 선택된 것 · 링크)에만 쓰고, 넓은 면을 칠하지 않는다.

### 스타일별 시작 값 (밝은 화면 / 어두운 화면)

| 스타일 | `--bg` | `--surface` | `--fg` | `--muted` | `--line` | `--accent` | `--accent-fg` |
|---|---|---|---|---|---|---|---|
| tool | `#ffffff` / `#111214` | `#f3f4f6` / `#1c1d21` | `#17181c` / `#ededf0` | `#5b5f69` / `#a3a7b1` | `#e3e5e9` / `#2c2e34` | `#2563eb` / `#6b9bff` | `#ffffff` / `#0b1020` |
| reading | `#fbf8f3` / `#16140f` | `#f2ede4` / `#211e17` | `#1f1b16` / `#ece6da` | `#625a4e` / `#b0a795` | `#e6ded0` / `#332e25` | `#9a3412` / `#f0a37a` | `#ffffff` / `#1a0e06` |
| data | `#ffffff` / `#0f1115` | `#f5f6f8` / `#181b21` | `#111318` / `#e8eaee` | `#596070` / `#a0a7b6` | `#e5e7eb` / `#272b33` | `#0e7490` / `#5cc8de` | `#ffffff` / `#05161a` |
| shop | `#fffaf4` / `#17120d` | `#f7eee3` / `#231b13` | `#2a1f15` / `#f1e7da` | `#6b5a48` / `#b9a68f` | `#eadccb` / `#3a2e22` | `#b45309` / `#f6ad55` | `#ffffff` / `#1b0f02` |
| play | `#fdfcff` / `#120f1a` | `#f1edfb` / `#1d1828` | `#1b1530` / `#eee9fb` | `#5d5675` / `#aaa2c4` | `#e4ddf5` / `#2e2741` | `#7c3aed` / `#b794f6` | `#ffffff` / `#140a26` |
| board | `#ffffff` / `#111214` | `#f4f5f7` / `#1b1c20` | `#18191d` / `#ececef` | `#5c606a` / `#a1a5ae` | `#e4e6ea` / `#2b2d33` | `#15803d` / `#5ccf86` | `#ffffff` / `#03140a` |

이 값들은 `--fg`/`--bg` · `--muted`/`--bg` · `--fg`/`--surface` · `--muted`/`--surface` · `--accent-fg`/`--accent` · `--accent`/`--bg`(링크 글자)가 모두 4.5:1을 넘는다. 값을 바꾸면 대비를 다시 잰다 (4장).
`--danger`는 모든 스타일에서 `#c0262d` / `#ff7b72`로 둔다 (오류 · 지우기에만).

## 3. 토큰 (이름을 바꾸지 않는다)

```css
:root {
  color-scheme: light dark;
  /* 색: 2장의 표에서 */
  --bg: #ffffff; --surface: #f3f4f6; --fg: #17181c; --muted: #5b5f69; --line: #e3e5e9;
  --accent: #2563eb; --accent-fg: #ffffff; --danger: #c0262d;
  /* 간격: 4의 배수만 */
  --space-1: 4px; --space-2: 8px; --space-3: 12px; --space-4: 16px;
  --space-5: 24px; --space-6: 32px; --space-7: 48px; --space-8: 64px;
  /* 글자: rem만 (사용자의 글자 크기 설정을 따른다) */
  --text-xs: 0.75rem; --text-sm: 0.875rem; --text-md: 1rem; --text-lg: 1.125rem;
  --text-xl: 1.25rem; --text-2xl: 1.5rem; --text-3xl: 2rem; --text-4xl: 2.5rem;
  --leading: 1.6; --leading-tight: 1.25;
  /* 모양 */
  --radius: 8px; --radius-full: 999px;
  --shadow: 0 1px 2px rgb(0 0 0 / 6%), 0 4px 12px rgb(0 0 0 / 6%);
  --measure: 65ch;
  --tap: 44px;
}
@media (prefers-color-scheme: dark) {
  :root { --bg: #111214; --surface: #1c1d21; --fg: #ededf0; --muted: #a3a7b1; --line: #2c2e34;
          --accent: #6b9bff; --accent-fg: #0b1020; --danger: #ff7b72;
          --shadow: 0 1px 2px rgb(0 0 0 / 40%), 0 4px 12px rgb(0 0 0 / 40%); }
}
```

색의 쓰임은 Radix의 12단계처럼 역할로 나눈다. 한 역할에 한 토큰만 쓴다.

| 역할 | 토큰 |
|---|---|
| 앱 바탕 | `--bg` |
| 칸 · 카드 · 입력의 바탕, 마우스를 올린 줄 | `--surface` |
| 구분선 · 입력 테두리(3:1이 필요한 곳은 `--muted`) | `--line` |
| 본문 · 제목 | `--fg` |
| 설명 · 날짜 · 보조 글 | `--muted` |
| 주 동작 단추 · 선택된 것 · 링크 | `--accent` (그 위 글자는 `--accent-fg`) |
| 오류 · 지우기 | `--danger` |

- 글자 크기는 화면마다 3~4단계만 쓴다 (본문 `--text-md`, 보조 `--text-sm`, 제목 둘).
- 간격은 가까운 것끼리 작게, 덩어리 사이는 크게 (`--space-2` 안 · `--space-6` 밖).
- 모서리는 `--radius` 하나로 통일한다 (알약 단추만 `--radius-full`).
- 그림자는 떠 있는 것(메뉴 · 대화 상자)에만. 카드는 그림자 대신 `--surface` 바탕이나 `--line` 선.

## 4. 체크리스트 (모두 지킨다)

**읽기 쉬움**
- 본문 글자와 바탕의 대비 4.5:1 이상, 큰 글자(24px 이상 · 굵은 19px 이상) · 아이콘 · 입력 테두리는 3:1 이상. 색으로만 뜻을 전하지 않는다 (오류는 글로도).
- 본문은 `--text-md`(16px) 이상, 줄 간격 1.5 이상, 한 줄 `--measure`(65자) 안. `font-size`를 12px보다 작게 하지 않는다.
- `<html lang="ko">`, 제목은 순서대로(`h1` 하나 → `h2` → `h3`). 긴 낱말은 `overflow-wrap: anywhere`로 칸을 넘지 않게.

**누르기 · 키보드**
- 누르는 곳은 폰에서 `--tap`(44px) 이상, 서로 8px 이상 떨어진다.
- 이동은 `<a href>`, 동작은 `<button>`. `div`에 `onclick`을 달지 않는다.
- 모든 링크 · 단추 · 입력에 보이는 포커스: `:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }`. `outline: none`만 쓰고 대신할 표시가 없으면 안 된다.
- 아이콘만 있는 단추에는 `aria-label`. 그림에는 `alt`(꾸밈 그림은 `alt=""`), `width` · `height`를 적어 자리가 흔들리지 않게.

**입력**
- 칸마다 보이는 `<label>`. 안내 글(placeholder)로 이름을 대신하지 않는다.
- 맞는 `type` · `inputmode` · `autocomplete` (전화 `tel`, 숫자 `inputmode="numeric"`, 이메일 `email`). 폰 입력 글자는 16px 이상 (확대 막기).
- 붙여넣기를 막지 않는다. 오류는 그 칸 바로 아래에 무엇을 고칠지 한 줄로.
- 보내는 동안 단추를 바쁨 표시로 바꾸고 두 번 보내지 않게 막는다.

**상태 (빠짐없이 그린다)**
- 처음 읽는 중 · 비었음 · 오류 · 다 됨. 빈 화면에는 무엇을 하면 채워지는지 한 줄과 그 동작.
- 지우기처럼 되돌릴 수 없는 동작은 한 번 더 묻는다. 끝난 일은 짧게 알린다.

**배치**
- 폰(360px)부터 만든다. 360px에서 가로 스크롤이 없고, 넓은 화면에서는 내용 폭을 1120px 안팎으로 묶는다.
- `<meta name="viewport" content="width=device-width, initial-scale=1">`. `user-scalable=no` · `maximum-scale=1`을 쓰지 않는다 (확대를 막는다).
- 폰의 아래 고정 막대는 `padding-bottom: env(safe-area-inset-bottom)`.
- 숫자 열 · 시간 · 가격은 `font-variant-numeric: tabular-nums`.

**움직임**
- 0.15~0.25초, `transform` · `opacity`만 움직인다 (자리 · 크기를 움직이지 않는다).
- `@keyframes` · `animation`을 쓰면 `@media (prefers-reduced-motion: reduce)`에서 멈춘다. 저절로 움직이는 것은 5초 안에 멈추거나 멈춤 단추를 둔다.

**어두운 화면**
- 토큰 값만 `@media (prefers-color-scheme: dark)`에서 바꾼다. 화면 코드에 어두운 화면 전용 색을 따로 적지 않는다.

## 5. AI가 만든 티 (피한다)

- 보라 → 파랑 그라디언트 바탕, 유리처럼 흐린 카드, 모든 칸의 큰 그림자.
- 모든 것을 가운데 정렬. 큰 제목 + 똑같은 카드 3개 + "Get started" · "Learn more" 단추로 된 첫 화면.
- 이모지를 아이콘으로 쓰기. 아이콘이 필요하면 선 아이콘 SVG를 직접 그린다 (`stroke="currentColor"`, 24칸, 선 1.5~2).
- 지어낸 숫자 · 후기 · 고객사 · 연락처. 모르면 비우거나 "준비 중"이라고 쓴다.
- 모서리 크기 · 회색 · 강조색이 화면마다 다른 것. 토큰을 쓰면 생기지 않는다.
- 쓸모없는 장식(배경 도형 · 반짝이)으로 실제 기능이 첫 화면 아래로 밀리는 것. **실제 내용 · 기능이 첫 화면에 보여야 한다.**

## 6. 러너의 "디자인 기준" 검사

러너가 AI가 낸 HTML · CSS를 읽어 본다. 떨어지면 아래 줄이 그대로 보이고 한 번 더 고칠 수 있다 (그래도 떨어지면 결과 카드에 적힌다. 일을 실패로 끝내지는 않는다).

- `:root`(또는 어두운 화면 블록)에 함께 적힌 색 짝의 대비: `--fg`/`--bg` · `--muted`/`--bg` · `--fg`/`--surface` · `--accent-fg`/`--accent` · `--accent`/`--bg`가 4.5:1 이상 (`#rgb` · `#rrggbb` 값만 잰다)
- `<head>`를 쓴 화면이면 `viewport` 메타가 있다 (머리 조각에 있어도 된다). 확대를 막지 않는다 (`user-scalable=no` · `maximum-scale=1` 없음)
- `<html>`에 `lang`
- `outline: none` · `outline: 0`을 쓰면 `:focus-visible` 규칙도 있다
- `font-size`를 12px 밑으로 두지 않는다
- `<img>`마다 `alt`
- `@keyframes` · `animation`을 쓰면 `prefers-reduced-motion` 규칙도 있다
