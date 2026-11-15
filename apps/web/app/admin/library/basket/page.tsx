import { BasketPanel } from './BasketPanel';

export const metadata = { title: '스크랩 · Cairn', robots: { index: false } };

export default function BasketPage() {
  return (
    <section className="console-inner narrow" aria-label="스크랩">
      <header className="page-head">
        <h1>스크랩</h1>
      </header>
      <BasketPanel />
    </section>
  );
}
