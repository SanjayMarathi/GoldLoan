import { Icon } from './Icon.tsx';

interface AboutProps {
  /** From /health: "anthropic:claude-opus-5-5", "openai-compat:…" or "offline-rules" */
  assistant?: string | undefined;
  /** From /health: "postgres" or "memory" */
  storage?: string | undefined;
}

function describeAssistant(assistant: string | undefined): string {
  if (!assistant) return 'Checking…';
  if (assistant.startsWith('anthropic:')) return `Claude (${assistant.slice('anthropic:'.length)}) through the Anthropic API`;
  if (assistant.startsWith('openai-compat:')) return `${assistant.slice('openai-compat:'.length)} through an OpenAI-compatible API`;
  return 'The built-in offline assistant (rule-based, no AI model – no API key is configured)';
}

export function About({ assistant, storage }: AboutProps) {
  return (
    <section className="card wide about">
      <header className="card-head">
        <span className="eyebrow">About</span>
        <h1>How it works</h1>
        <p className="muted">A gold loan estimate you can trust – and an assistant that files the paperwork only when you say so.</p>
      </header>

      <div className="about-grid">
        <article>
          <Icon name="bolt" size={22} />
          <h3>Instant estimate</h3>
          <p>
            Pure gold = net weight × karat ÷ 24. Value = pure gold × the 24K rate. The loan is at most 75% of the value and never
            more than your plan’s limit, rounded down to whole rupees. All money maths uses whole paise – no rounding drift.
          </p>
        </article>
        <article>
          <Icon name="sparkle" size={22} />
          <h3>Loan Assist</h3>
          <p>
            Chat in English or Hinglish. The assistant never does the maths itself – it calls the same calculator as the form, every
            number it says is checked against those results, and only <i>you</i> can press Confirm to file an application.
          </p>
        </article>
        <article>
          <Icon name="shield" size={22} />
          <h3>Your privacy</h3>
          <p>
            Mobile numbers are masked everywhere outside the database, including logs. AI calls happen on our server, so no key ever
            reaches your browser. The server re-checks every figure before an application is saved.
          </p>
        </article>
      </div>

      <h2 className="section-title plain">What this demo is running right now</h2>
      <dl className="summary about-facts">
        <div className="summary-row">
          <dt>Loan Assist</dt>
          <dd>{describeAssistant(assistant)}</dd>
        </div>
        <div className="summary-row">
          <dt>Database</dt>
          <dd>{!storage ? 'Checking…' : storage === 'postgres' ? 'PostgreSQL' : 'In-memory (data is lost on restart)'}</dd>
        </div>
        <div className="summary-row">
          <dt>Gold rate</dt>
          <dd>Fixed mock ₹7,000 per gram (24K), as the assignment specifies</dd>
        </div>
        <div className="summary-row">
          <dt>Admin view</dt>
          <dd>Open to anyone in this demo (no login) – mobiles are masked</dd>
        </div>
      </dl>

      <p className="disclaimer">
        <Icon name="info" size={16} />
        <span>
          Demo project. Estimates are indicative; the final loan amount is decided after physical appraisal and is not a promise of
          approval.
        </span>
      </p>
    </section>
  );
}
