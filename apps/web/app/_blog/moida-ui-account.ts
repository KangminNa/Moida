// moida.js의 회원 · 데이터 부품 (2026-11-28): <moida-account> · <moida-rows>.
//   <moida-account>  로그인 전이면 "로그인" · "가입", 로그인했으면 닉네임과 "로그아웃". 격리된 화면(moida.open 거짓)에서는 안내 한 줄.
//     알림: moida:ready {member}
//   <moida-rows table="guestbook" [order="created_at desc"] [limit="20"] [mine]>
//     <template><article><h3 data-field="title"></h3><p data-field="body"></p></article></template>
//   </moida-rows>
//     앱 데이터 표의 줄마다 template을 한 벌씩 복사해 data-field 칸에 그 줄의 값을 글자로(textContent) 넣는다. HTML로 넣지 않는다.
//     줄이 없으면 "아직 없어요", 격리된 화면이면 안내. 알림: moida:ready {rows, more}. 다시 읽기: 요소.reload()
// UI_BASE(moida-ui-base.ts)와 한 함수 안에서 이어 붙는다

export const UI_ACCOUNT = String.raw`
  const CLOSED_NOTE = '앱의 도메인에서 열면 쓸 수 있어요';

  define('moida-account', () => class extends HTMLElement {
    connectedCallback() {
      if (this.started) return;
      this.started = true;
      this.classList.add('moida-account');
      this.draw();
    }
    button(label, main, onClick) {
      const b = el('button', 'moida-button' + (main ? ' is-main' : ''), label);
      b.type = 'button';
      b.addEventListener('click', onClick);
      return b;
    }
    async draw() {
      if (!M.open) {
        this.replaceChildren(el('span', 'moida-note', CLOSED_NOTE));
        emit(this, 'ready', { member: null });
        return;
      }
      let member = null;
      try {
        member = (await M.me()).member;
      } catch {
        member = null;
      }
      if (member) {
        const out = this.button('로그아웃', false, async () => {
          out.disabled = true;
          try {
            await M.logout();
          } finally {
            this.draw();
          }
        });
        this.replaceChildren(el('span', 'moida-who', member.nickname || member.loginId || '회원'), out);
      } else {
        this.replaceChildren(this.button('로그인', true, () => M.login()), this.button('가입', false, () => M.join()));
      }
      emit(this, 'ready', { member });
    }
  });

  define('moida-rows', () => class extends HTMLElement {
    connectedCallback() {
      if (this.started) return;
      this.started = true;
      this.template = this.querySelector('template');
      this.box = el('div', 'moida-rows-list');
      this.state = el('p', 'moida-empty', '불러오는 중…');
      this.state.setAttribute('aria-live', 'polite');
      this.replaceChildren(...(this.template ? [this.template] : []), this.state, this.box);
      this.reload();
    }
    query() {
      const q = M.from(this.getAttribute('table')).select();
      const order = (this.getAttribute('order') || '').trim().split(/\s+/);
      if (order[0]) q.order(order[0], order[1] === 'asc' ? 'asc' : 'desc');
      const limit = Number(this.getAttribute('limit'));
      q.limit(Number.isInteger(limit) && limit > 0 ? Math.min(limit, 100) : 20);
      if (this.hasAttribute('mine')) q.mine();
      return q;
    }
    fill(row) {
      const part = this.template.content.cloneNode(true);
      for (const slot of part.querySelectorAll('[data-field]')) {
        const value = row[slot.getAttribute('data-field')];
        slot.textContent = value === undefined || value === null ? '' : String(value);
      }
      return part;
    }
    async reload() {
      if (!M.open) {
        this.state.textContent = CLOSED_NOTE;
        return;
      }
      if (!this.template || !this.getAttribute('table')) {
        this.state.textContent = 'table과 template이 필요해요';
        return;
      }
      try {
        const { rows, more } = await this.query();
        this.box.replaceChildren(...rows.map((row) => this.fill(row)));
        this.state.textContent = rows.length === 0 ? '아직 없어요' : '';
        this.state.hidden = rows.length > 0;
        emit(this, 'ready', { rows, more });
      } catch (error) {
        this.state.hidden = false;
        this.state.textContent = error.message;
      }
    }
  });
`;
