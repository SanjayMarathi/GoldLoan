import { Icon } from './Icon.tsx';

interface AboutProps {
  /** From /health: "openai-compat:gemini-3.5-flash-lite", "anthropic:claude-opus-5-5" or "offline-rules" */
  assistant?: string | undefined;
  /** From /health: "postgres" or "memory" */
  storage?: string | undefined;
}

const REPO = 'https://github.com/SanjayMarathi/GoldLoan';

function describeAssistant(assistant: string | undefined): string {
  if (!assistant) return 'Checking…';
  const [kind, model = ''] = assistant.split(':');
  if (kind === 'anthropic') return `Anthropic Claude – ${model}, through the official Anthropic SDK`;
  if (kind === 'openai-compat') {
    const vendor = model.startsWith('gemini') ? 'Google Gemini' : 'An OpenAI-compatible model';
    return `${vendor} – ${model}, through an OpenAI-compatible API`;
  }
  return 'The built-in offline assistant (rule-based, no AI model): no LLM key is configured';
}

function Facts({ rows }: { rows: Array<[string, string]> }) {
  return (
    <dl className="summary about-facts">
      {rows.map(([k, v]) => (
        <div key={k} className="summary-row">
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
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
            more than your plan’s limit, rounded down to whole rupees.
          </p>
        </article>
        <article>
          <Icon name="sparkle" size={22} />
          <h3>Loan Assist</h3>
          <p>
            Chat in English or Hinglish. The assistant never does the maths itself – it uses the same calculator as the form – and
            only <i>you</i> can press Confirm to file an application.
          </p>
        </article>
        <article>
          <Icon name="shield" size={22} />
          <h3>Your privacy</h3>
          <p>Mobile numbers are masked everywhere they are shown. Every figure is checked again on our side before an application is saved.</p>
        </article>
      </div>

      <p className="disclaimer">
        <Icon name="info" size={16} />
        <span>Estimates are indicative; the final loan amount is decided after physical appraisal and is not a promise of approval.</span>
      </p>

      <div className="reviewers">
        <header>
          <span className="eyebrow">For reviewers</span>
          <h2 className="section-title plain">Technical details</h2>
          <p className="muted">
            Built for the TGlobal Full-Stack Developer assignment. The full write-up, test results and AI log are in the{' '}
            <a href={REPO} target="_blank" rel="noreferrer">
              GitHub repository
            </a>
            .
          </p>
        </header>

        <h3>Running right now</h3>
        <Facts
          rows={[
            ['AI assistant', describeAssistant(assistant)],
            ['Database', !storage ? 'Checking…' : storage === 'postgres' ? 'PostgreSQL' : 'In-memory (demo data, lost on restart)'],
            ['Gold rate', 'Fixed mock ₹7,000 per gram (24K), as the assignment specifies'],
            ['Admin panel', 'Open to anyone in this demo (no login); mobile numbers are masked'],
          ]}
        />

        <h3>Technology</h3>
        <Facts
          rows={[
            ['Frontend', 'React 18 + Vite + TypeScript, plain CSS (no UI library); fonts self-hosted'],
            ['Backend', 'Node.js 22, Express 4, TypeScript, Zod validation, helmet, pino logging'],
            ['Database', 'PostgreSQL 16 via pg, SQL migrations + seed, advisory-lock duplicate check, CHECK constraints (LTV ≤ 75%)'],
            ['AI agent', 'Tool-calling loop on the server; Google Gemini (default) or Anthropic Claude; rule-based offline fallback'],
            ['Shared code', 'One package of Zod schemas, types and money formatting used by the UI, the API and the agent'],
            ['Testing', 'node:test unit, API and PostgreSQL tests + 16 scripted agent conversations, run by GitHub Actions on every push'],
            ['Deployment', 'One Docker image (the API serves the built app); docker compose locally; Hugging Face Space + hosted PostgreSQL'],
          ]}
        />

        <h3>How the AI agent works</h3>
        <ul className="about-list">
          <li>
            <b>Four tools:</b> <code>get_loan_schemes</code>, <code>calculate_quote</code> (the same service as <code>POST /quotes</code>),{' '}
            <code>check_existing_application</code> and <code>submit_application</code>. Tool arguments are validated with the same Zod
            schemas as the REST API.
          </li>
          <li>
            <b>No maths by the model:</b> every ₹, gram, % and application id in a reply must appear in a tool result or in what the user
            typed; otherwise the reply is retried once, then replaced by a safe answer.
          </li>
          <li>
            <b>Confirmation:</b> <code>submit_application</code> only prepares the summary card. Only the Confirm button files the
            application – through the same service as the form – and typing “yes” does not.
          </li>
          <li>
            <b>Guardrails:</b> prompt-injection filter, gold loans only, no investment advice, no approval promises, masked mobiles in
            tool results and logs. API keys stay on the server.
          </li>
        </ul>

        <h3>Money maths and rules</h3>
        <ul className="about-list">
          <li>
            Integer arithmetic only (milligrams, paise, basis points): pure gold = net × karat ÷ 24; value = pure gold × rate; loan =
            floor(value × min(plan LTV, 75%)).
          </li>
          <li>The server recomputes every figure on submit; client-sent amounts are ignored.</li>
          <li>The same mobile number cannot apply twice within 7 days (409 with the existing application id), even under simultaneous requests.</li>
          <li>Idempotency-Key retries, a SUBMITTED → UNDER_REVIEW → APPROVED / REJECTED workflow and an audit log.</li>
        </ul>

        <h3>API</h3>
        <ul className="about-list mono-list">
          <li>GET /api/v1/loan-schemes · POST /api/v1/quotes</li>
          <li>POST /api/v1/leads · GET /api/v1/leads · GET /api/v1/leads/summary · GET /api/v1/leads/:id</li>
          <li>POST /api/v1/leads/lookup · PATCH /api/v1/leads/:id/status · GET /api/v1/leads/:id/audit</li>
          <li>POST /api/v1/chat · POST /api/v1/chat/confirm · GET /api/v1/gold-rate · GET /api/v1/health</li>
        </ul>

        <h3>Documents</h3>
        <ul className="about-list">
          <li>
            <a href={`${REPO}#readme`} target="_blank" rel="noreferrer">README</a> – setup, the assignment checklist, what was and wasn’t tested
          </li>
          <li>
            <a href={`${REPO}/blob/main/ARCHITECTURE.md`} target="_blank" rel="noreferrer">ARCHITECTURE.md</a> and{' '}
            <a href={`${REPO}/blob/main/docs/AGENT_DESIGN.md`} target="_blank" rel="noreferrer">AGENT_DESIGN.md</a> – design
          </li>
          <li>
            <a href={`${REPO}/blob/main/AI_LOG.md`} target="_blank" rel="noreferrer">AI_LOG.md</a> – how AI tools were used and where they were wrong
          </li>
        </ul>
      </div>
    </section>
  );
}
