import {
  Activity,
  Bot,
  Coins,
  Database,
  Gauge,
  Headphones,
  Radio,
  RefreshCw,
  Send,
  Shield,
  Sparkles,
  User,
  Wallet,
  Zap
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { parseSseBuffer } from './sse';

type Config = {
  defaultModel: string;
  demoMode: boolean;
  postgresEnabled: boolean;
  solanaEnabled: boolean;
  actionCredits: number;
};

type ChatLine = {
  role: 'user' | 'assistant';
  content: string;
};

type Sector = {
  id: string;
  name: string;
  x: number;
  y: number;
  risk: number;
  reward: number;
  color: string;
};

const sectors: Sector[] = [
  { id: 'dock', name: 'Dock Zero', x: 14, y: 72, risk: 1, reward: 2, color: '#5fd3bc' },
  { id: 'glass', name: 'Glass Reef', x: 32, y: 42, risk: 3, reward: 5, color: '#ffd166' },
  { id: 'coil', name: 'Coil Gate', x: 48, y: 64, risk: 4, reward: 7, color: '#ef476f' },
  { id: 'halo', name: 'Halo Archive', x: 64, y: 28, risk: 2, reward: 8, color: '#72ddf7' },
  { id: 'forge', name: 'Forge Moon', x: 82, y: 58, risk: 5, reward: 10, color: '#f4a261' }
];

const starter: ChatLine[] = [
  {
    role: 'assistant',
    content: 'Pick a sector and stream a move. I will route through app.nz auto models when an API key is configured.'
  }
];

const fallbackConfig: Config = {
  defaultModel: 'appnz/auto-fast',
  demoMode: true,
  postgresEnabled: false,
  solanaEnabled: false,
  actionCredits: 0
};

const fallbackUsage = {
  demo: true,
  credits: { total: 4200 },
  models: { costMicros: 12500 },
  servers: { count: 0 }
};

export function App() {
  const [config, setConfig] = useState<Config | null>(null);
  const [me, setMe] = useState<{ authenticated?: boolean; user?: { email?: string; id?: string } } | null>(null);
  const [usage, setUsage] = useState<any>(null);
  const [runs, setRuns] = useState<any[]>([]);
  const [ledger, setLedger] = useState<any[]>([]);
  const [sector, setSector] = useState<Sector>(sectors[0]);
  const [model, setModel] = useState('appnz/auto-fast');
  const [input, setInput] = useState('Plan the safest jump and tell me what to spend credits on.');
  const [lines, setLines] = useState<ChatLine[]>(starter);
  const [streaming, setStreaming] = useState(false);
  const [ship, setShip] = useState({ hull: 91, charge: 64, heat: 18, credits: 3200 });
  const [quote, setQuote] = useState<any>(null);
  const [signature, setSignature] = useState('');
  const [status, setStatus] = useState('Ready');
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    void refreshAll();
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ block: 'end' });
  }, [lines, streaming]);

  async function refreshAll() {
    const [cfg, who, bill, history] = await Promise.all([
      fetchJson('/api/config', fallbackConfig),
      fetchJson('/api/me', { authenticated: false }),
      fetchJson('/api/usage', fallbackUsage),
      fetchJson('/api/runs', { runs: [], ledger: [] })
    ]);
    setConfig(cfg);
    setMe(who);
    setUsage(bill);
    setRuns(history.runs || []);
    setLedger(history.ledger || []);
    setModel(cfg.defaultModel || 'appnz/auto-fast');
  }

  const routePath = useMemo(() => {
    const from = sectors[0];
    return `M ${from.x} ${from.y} L ${sector.x} ${sector.y}`;
  }, [sector]);

  async function streamMove() {
    if (!input.trim() || streaming) return;
    setStreaming(true);
    setStatus('Streaming autopilot');
    const userLine: ChatLine = { role: 'user', content: input.trim() };
    setLines((prev) => [...prev, userLine, { role: 'assistant', content: '' }]);
    setInput('');

    const body = JSON.stringify({
      model,
      sector: sector.name,
      ship,
      messages: [{ role: 'user', content: userLine.content }]
    });

    let res: Response;
    try {
      res = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
    } catch {
      await localDemoMove(userLine.content);
      return;
    }

    if (!res.ok || !res.body || !String(res.headers.get('content-type') || '').includes('text/event-stream')) {
      await localDemoMove(userLine.content);
      setStreaming(false);
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        const parsed = parseSseBuffer(buffer, decoder.decode(value, { stream: true }));
        buffer = parsed.rest;
        for (const evt of parsed.events) {
          const data = evt.data as any;
          if (evt.event === 'token') setLines((prev) => patchLastAssistant(prev, data.text || ''));
          if (evt.event === 'meta') setStatus(data.demoMode ? 'Demo stream' : `Routed ${data.model}`);
          if (evt.event === 'error') setLines((prev) => patchLastAssistant(prev, `\n${data.error}`));
        }
      }
      setShip((prev) => ({
        hull: Math.max(20, prev.hull - sector.risk * 3),
        charge: Math.max(0, prev.charge - 9 + sector.reward),
        heat: Math.min(100, prev.heat + sector.risk * 4),
        credits: prev.credits + sector.reward * 140
      }));
      setStatus('Move resolved');
      await refreshHistoryOnly();
    } finally {
      setStreaming(false);
    }
  }

  async function refreshHistoryOnly() {
    const history = await fetchJson('/api/runs', { runs: [], ledger: [] });
    setRuns(history.runs || []);
    setLedger(history.ledger || []);
  }

  async function localDemoMove(prompt: string) {
    setStatus('Static demo stream');
    const tokens = [
      'Static demo autopilot online. ',
      `${sector.name} is the right visual route for this run. `,
      /safe|safest|risk/i.test(prompt) ? 'Shields first, credits second. ' : 'Spend a probe, then bank the reward. ',
      'Deploy the server runtime on app.nz to switch this from local demo text to the model router.'
    ];
    for (const token of tokens) {
      await new Promise((resolve) => setTimeout(resolve, 120));
      setLines((prev) => patchLastAssistant(prev, token));
    }
    setStreaming(false);
  }

  async function speakLast() {
    const last = [...lines].reverse().find((line) => line.role === 'assistant' && line.content.trim());
    if (!last) return;
    setStatus('Requesting audio');
    let res: Response;
    try {
      res = await fetch('/api/audio/speech', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: last.content.slice(0, 1200) })
      });
    } catch {
      setStatus('Audio needs server runtime');
      return;
    }
    if (!res.ok) {
      setStatus('Audio needs APPNZ_API_KEY');
      return;
    }
    const blob = await res.blob();
    const audio = new Audio(URL.createObjectURL(blob));
    await audio.play();
    setStatus('Playing audio');
  }

  async function createQuote(credits: number) {
    let res: Response;
    try {
      res = await fetch('/api/payments/solana/quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credits })
      });
    } catch {
      setStatus('Solana quote needs server runtime');
      return;
    }
    const body = await res.json();
    setQuote(body.quote || null);
    if (body.error) setStatus(body.error);
  }

  async function verifyQuote() {
    if (!quote) return;
    const res = await fetch('/api/payments/solana/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...quote, signature })
    });
    const body = await res.json();
    setStatus(body.verified ? 'Solana credit recorded' : body.reason || body.error || 'Payment not verified');
    await refreshHistoryOnly();
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark"><Sparkles size={19} /></span>
          <div>
            <h1>AppChat</h1>
            <p>Streaming AI space run on app.nz</p>
          </div>
        </div>
        <div className="top-actions">
          <StatusPill icon={<User size={15} />} label={me?.authenticated ? me.user?.email || 'Signed in' : 'Demo user'} />
          <StatusPill icon={<Database size={15} />} label={config?.postgresEnabled ? 'Postgres' : 'Memory'} />
          <button className="icon-button" title="Refresh account and history" onClick={refreshAll}>
            <RefreshCw size={17} />
          </button>
        </div>
      </header>

      <main className="workspace">
        <section className="map-panel">
          <div className="panel-title">
            <div>
              <span>Starmap</span>
              <strong>{sector.name}</strong>
            </div>
            <StatusPill icon={<Radio size={15} />} label={status} />
          </div>
          <div className="star-stage" aria-label="Interactive sector map">
            <svg viewBox="0 0 100 100" role="img" aria-label="route map">
              <defs>
                <pattern id="grid" width="8" height="8" patternUnits="userSpaceOnUse">
                  <path d="M 8 0 L 0 0 0 8" fill="none" stroke="rgba(255,255,255,.08)" strokeWidth=".3" />
                </pattern>
              </defs>
              <rect width="100" height="100" fill="url(#grid)" />
              <path d={routePath} className="route-line" />
              {sectors.map((s) => (
                <g key={s.id} onClick={() => setSector(s)} className={s.id === sector.id ? 'sector active' : 'sector'}>
                  <circle cx={s.x} cy={s.y} r={s.id === sector.id ? 5.8 : 4.4} fill={s.color} />
                  <text x={s.x > 70 ? s.x - 4 : s.x + 4} y={s.y - 5} textAnchor={s.x > 70 ? 'end' : 'start'}>{s.name}</text>
                </g>
              ))}
              <circle cx="14" cy="72" r="9" className="scan-ring" />
            </svg>
          </div>
          <div className="meters">
            <Meter icon={<Shield size={16} />} label="Hull" value={ship.hull} tone="green" />
            <Meter icon={<Zap size={16} />} label="Charge" value={ship.charge} tone="yellow" />
            <Meter icon={<Gauge size={16} />} label="Heat" value={ship.heat} tone="red" />
            <Meter icon={<Coins size={16} />} label="Run credits" value={Math.min(100, ship.credits / 50)} text={String(ship.credits)} tone="cyan" />
          </div>
        </section>

        <section className="chat-panel">
          <div className="panel-title">
            <div>
              <span>Autopilot</span>
              <strong>{model}</strong>
            </div>
            <button className="icon-button" title="Speak latest assistant message" onClick={speakLast}>
              <Headphones size={17} />
            </button>
          </div>
          <div className="model-row">
            {['appnz/auto-fast', 'appnz/auto', 'appnz/auto-cheap', 'openpaths/auto-fast'].map((m) => (
              <button key={m} className={model === m ? 'chip selected' : 'chip'} onClick={() => setModel(m)}>{m}</button>
            ))}
          </div>
          <div className="transcript">
            {lines.map((line, idx) => (
              <div key={`${idx}-${line.role}`} className={`bubble ${line.role}`}>
                <div className="bubble-icon">{line.role === 'assistant' ? <Bot size={16} /> : <User size={16} />}</div>
                <p>{line.content || (streaming && idx === lines.length - 1 ? '...' : '')}</p>
              </div>
            ))}
            <div ref={chatEndRef} />
          </div>
          <div className="composer">
            <textarea value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask the model router for a move..." />
            <button onClick={streamMove} disabled={streaming || !input.trim()} title="Stream move">
              <Send size={17} />
              <span>{streaming ? 'Streaming' : 'Stream'}</span>
            </button>
          </div>
        </section>

        <aside className="ops-panel">
          <SectionTitle icon={<Activity size={16} />} label="app.nz account" />
          <div className="stats-grid">
            <Stat label="Credits" value={usage?.credits?.total ?? usage?.credits?.paid ?? 'demo'} />
            <Stat label="Model spend" value={usage?.models?.costMicros ? `$${(usage.models.costMicros / 1_000_000).toFixed(4)}` : '$0.0000'} />
            <Stat label="Servers" value={usage?.servers?.count ?? 0} />
            <Stat label="Charge" value={config?.actionCredits ? `${config.actionCredits} cr` : 'off'} />
          </div>

          <SectionTitle icon={<Wallet size={16} />} label="Solana prepaid" />
          <div className="wallet-box">
            <button onClick={() => createQuote(1000)} className="secondary-button">Quote 1,000 credits</button>
            {quote && (
              <>
                <div className="quote">
                  <span>{quote.sol} SOL</span>
                  <a href={quote.url}>Open wallet link</a>
                </div>
                <input value={signature} onChange={(e) => setSignature(e.target.value)} placeholder="transaction signature" />
                <button onClick={verifyQuote} className="secondary-button">Verify payment</button>
              </>
            )}
          </div>

          <SectionTitle icon={<Database size={16} />} label="Recent runs" />
          <div className="history-list">
            {runs.slice(0, 5).map((run) => (
              <button key={run.id} onClick={() => setSector(sectors.find((s) => s.name === run.sector) || sector)}>
                <strong>{run.sector || 'Unknown sector'}</strong>
                <span>{run.model}</span>
              </button>
            ))}
            {!runs.length && <p className="muted">Run history appears here after the first stream.</p>}
          </div>
          {!!ledger.length && <p className="muted">{ledger.length} ledger event{ledger.length === 1 ? '' : 's'} stored.</p>}
        </aside>
      </main>
    </div>
  );
}

async function fetchJson<T>(url: string, fallback: T): Promise<T> {
  try {
    const res = await fetch(url);
    if (!res.ok || !String(res.headers.get('content-type') || '').includes('application/json')) return fallback;
    return await res.json();
  } catch {
    return fallback;
  }
}

function patchLastAssistant(lines: ChatLine[], token: string) {
  const next = [...lines];
  for (let i = next.length - 1; i >= 0; i -= 1) {
    if (next[i].role === 'assistant') {
      next[i] = { ...next[i], content: next[i].content + token };
      break;
    }
  }
  return next;
}

function StatusPill({ icon, label }: { icon: React.ReactNode; label: string }) {
  return <span className="status-pill">{icon}{label}</span>;
}

function SectionTitle({ icon, label }: { icon: React.ReactNode; label: string }) {
  return <h2 className="section-title">{icon}{label}</h2>;
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return <div className="stat"><span>{label}</span><strong>{value}</strong></div>;
}

function Meter({ icon, label, value, text, tone }: { icon: React.ReactNode; label: string; value: number; text?: string; tone: string }) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div className={`meter ${tone}`}>
      <div className="meter-label">{icon}<span>{label}</span><strong>{text || `${Math.round(clamped)}%`}</strong></div>
      <div className="meter-track"><span style={{ width: `${clamped}%` }} /></div>
    </div>
  );
}
