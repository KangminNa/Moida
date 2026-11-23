import { AiPanel } from './AiPanel';
import { LeadPanel } from './LeadPanel';
import { UsagePanel } from './UsagePanel';

export default function AiPage() {
  return (
    <section className="console-inner narrow" aria-label="AI">
      <AiPanel />
      <UsagePanel />
      <LeadPanel />
    </section>
  );
}
