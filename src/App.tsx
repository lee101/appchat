import {
  Bot,
  CheckCircle2,
  Coins,
  Copy,
  Database,
  ExternalLink,
  Headphones,
  KeyRound,
  LogIn,
  RefreshCw,
  Send,
  Sparkles,
  User,
  Wallet
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { parseSseBuffer } from './sse';

type Config = {
  appnzBase: string;
  publicUrl: string;
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

const fallbackConfig: Config = {
  appnzBase: 'https://app.nz',
  publicUrl: window.location.origin,
  defaultModel: 'appnz/auto-fast',
  demoMode: true,
  postgresEnabled: false,
  solanaEnabled: false,
  actionCredits: 0
};

const fallbackUsage = {
  demo: true,
  credits: { total: 0 },
  models: { costMicros: 0 },
  servers: { count: 0 }
};

const starter: ChatLine[] = [
  {
    role: 'assistant',
    content: 'Ask anything. I stream through the app.nz model router when this app has APPNZ_API_KEY configured, or when you add your own key here.'
  }
];

const models = ['appnz/auto-fast', 'appnz/auto', 'appnz/auto-cheap', 'openpaths/auto-fast'];

export function App() {
  const [config, setConfig] = useState<Config>(fallbackConfig);
  const [me, setMe] = useState<{ authenticated?: boolean; user?: { email?: string; id?: string } }>({ authenticated: false });
  const [usage, setUsage] = useState<any>(fallbackUsage);
  const [runs, setRuns] = useState<any[]>([]);
  const [ledger, setLedger] = useState<any[]>([]);
  const [model, setModel] = useState(fallbackConfig.defaultModel);
  const [input, setInput] = useState('Give me a concise plan for shipping this app on app.nz.');
  const [lines, setLines] = useState<ChatLine[]>(starter);
  const [streaming, setStreaming] = useState(false);
  const [status, setStatus] = useState('Ready');
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('appchat.apiKey') || '');
  const [showKey, setShowKey] = useState(false);
  const [quote, setQuote] = useState<any>(null);
  const [signature, setSignature] = useState('');
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    void refreshAll();
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ block: 'end' });
  }, [lines, streaming]);

  const loginUrl = useMemo(() => {
    const next = encodeURIComponent(config.publicUrl || window.location.href);
    return `${config.appnzBase}/login?next=${next}`;
  }, [config.appnzBase, config.publicUrl]);

  const accountUrl = `${config.appnzBase}/account`;
  const apiKeysUrl = `${config.appnzBase}/account?section=api-keys`;
  const usingPersonalKey = Boolean(apiKey.trim());
  const liveRouter = usingPersonalKey || !config.demoMode;

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
    setModel(cfg.defaultModel || fallbackConfig.defaultModel);
  }

  function saveApiKey() {
    const trimmed = apiKey.trim();
    if (trimmed) localStorage.setItem('appchat.apiKey', trimmed);
    else localStorage.removeItem('appchat.apiKey');
    setApiKey(trimmed);
    setStatus(trimmed ? 'Personal API key saved locally' : 'Personal API key removed');
  }

  async function streamChat() {
    if (!input.trim() || streaming) return;
    setStreaming(true);
    setStatus(liveRouter ? `Streaming ${model}` : 'Demo stream');
    const userLine: ChatLine = { role: 'user', content: input.trim() };
    setLines((prev) => [...prev, userLine, { role: 'assistant', content: '' }]);
    setInput('');

    const history = [...lines, userLine]
      .filter((line) => line.content.trim())
      .slice(-12)
      .map((line) => ({ role: line.role, content: line.content }));

    let res: Response;
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (apiKey.trim()) headers['X-AppNZ-API-Key'] = apiKey.trim();
      res = await fetch('/api/chat', {
        method: 'POST',
        headers,
        body: JSON.stringify({ model, messages: history })
      });
    } catch {
      await localDemoReply(userLine.content);
      return;
    }

    if (!res.ok || !res.body || !String(res.headers.get('content-type') || '').includes('text/event-stream')) {
      await localDemoReply(userLine.content);
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
          if (evt.event === 'done') setStatus('Done');
        }
      }
      await refreshHistoryOnly();
    } finally {
      setStreaming(false);
      inputRef.current?.focus();
    }
  }

  async function refreshHistoryOnly() {
    const history = await fetchJson('/api/runs', { runs: [], ledger: [] });
    setRuns(history.runs || []);
    setLedger(history.ledger || []);
  }

  async function localDemoReply(prompt: string) {
    setStatus('Static demo');
    const tokens = [
      'This is the local demo path. ',
      /key|api/i.test(prompt) ? 'Add APPNZ_API_KEY in the app env or paste your personal key to route real models. ' : 'The UI is ready; connect an app.nz key to stream from the router. ',
      'Login links, usage, Postgres history, and Solana quotes still show the production integration points.'
    ];
    for (const token of tokens) {
      await new Promise((resolve) => setTimeout(resolve, 90));
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
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (apiKey.trim()) headers['X-AppNZ-API-Key'] = apiKey.trim();
      res = await fetch('/api/audio/speech', {
        method: 'POST',
        headers,
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
          <span className="brand-mark"><Sparkles size={18} /></span>
          <div>
            <h1>AppChat</h1>
            <p>Compact streaming chat on app.nz</p>
          </div>
        </div>
        <div className="top-actions">
          <StatusPill icon={liveRouter ? <CheckCircle2 size={15} /> : <KeyRound size={15} />} label={liveRouter ? 'Router ready' : 'Needs key'} />
          <StatusPill icon={<Database size={15} />} label={config.postgresEnabled ? 'Postgres' : 'Memory'} />
          <button className="icon-button" title="Refresh account and history" onClick={refreshAll}>
            <RefreshCw size={17} />
          </button>
        </div>
      </header>

      <main className="workspace">
        <section className="chat-panel">
          <div className="panel-title">
            <div>
              <span>Chat</span>
              <strong>{model}</strong>
            </div>
            <div className="title-actions">
              <StatusPill icon={<Bot size={15} />} label={status} />
              <button className="icon-button" title="Speak latest assistant message" onClick={speakLast}>
                <Headphones size={17} />
              </button>
            </div>
          </div>

          <div className="model-row" aria-label="Model picker">
            {models.map((m) => (
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
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void streamChat();
                }
              }}
              placeholder="Message AppChat"
            />
            <button onClick={streamChat} disabled={streaming || !input.trim()} title="Send message">
              <Send size={17} />
              <span>{streaming ? 'Streaming' : 'Send'}</span>
            </button>
          </div>
        </section>

        <aside className="side-panel">
          <section className="side-section">
            <SectionTitle icon={<LogIn size={16} />} label="app.nz account" />
            <div className="account-card">
              <div>
                <strong>{me.authenticated ? me.user?.email || 'Signed in' : 'Not signed in'}</strong>
                <span>{me.authenticated ? 'Using app.nz auth cookies' : 'Login to use account usage and app auth'}</span>
              </div>
              <a className="secondary-button" href={me.authenticated ? accountUrl : loginUrl}>
                {me.authenticated ? 'Account' : 'Login'}
                <ExternalLink size={14} />
              </a>
            </div>
            <div className="stats-grid">
              <Stat label="Credits" value={usage?.credits?.total ?? usage?.credits?.paid ?? 'demo'} />
              <Stat label="Model spend" value={usage?.models?.costMicros ? `$${(usage.models.costMicros / 1_000_000).toFixed(4)}` : '$0.0000'} />
            </div>
          </section>

          <section className="side-section">
            <SectionTitle icon={<KeyRound size={16} />} label="Use your API key" />
            <div className="key-box">
              <input
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="APPNZ_API_KEY"
                autoComplete="off"
              />
              <div className="key-actions">
                <button className="secondary-button" onClick={() => setShowKey((v) => !v)}>{showKey ? 'Hide' : 'Show'}</button>
                <button className="secondary-button" onClick={saveApiKey}>Save</button>
              </div>
              <a className="inline-link" href={apiKeysUrl}>
                Get an API key on app.nz
                <ExternalLink size={13} />
              </a>
            </div>
          </section>

          <section className="side-section">
            <SectionTitle icon={<Wallet size={16} />} label="Payments" />
            <div className="wallet-box">
              <button onClick={() => createQuote(1000)} className="secondary-button" disabled={!config.solanaEnabled}>
                <Coins size={15} />
                Quote 1,000 credits
              </button>
              {quote && (
                <>
                  <div className="quote">
                    <span>{quote.sol} SOL</span>
                    <a href={quote.url}>Open wallet link</a>
                    <button className="icon-button compact" title="Copy payment link" onClick={() => navigator.clipboard?.writeText(quote.url)}>
                      <Copy size={14} />
                    </button>
                  </div>
                  <input value={signature} onChange={(e) => setSignature(e.target.value)} placeholder="transaction signature" />
                  <button onClick={verifyQuote} className="secondary-button">Verify payment</button>
                </>
              )}
              {!config.solanaEnabled && <p className="muted">Set SOLANA_RECEIVER_ADDRESS to enable wallet quotes.</p>}
            </div>
          </section>

          <section className="side-section">
            <SectionTitle icon={<Database size={16} />} label="History" />
            <div className="history-list">
              {runs.slice(0, 6).map((run) => (
                <button key={run.id} onClick={() => setLines((prev) => [...prev, { role: 'assistant', content: run.response || run.prompt }])}>
                  <strong>{run.prompt || 'Previous chat'}</strong>
                  <span>{run.model}</span>
                </button>
              ))}
              {!runs.length && <p className="muted">Recent chats appear here after the first stream.</p>}
            </div>
            {!!ledger.length && <p className="muted ledger-note">{ledger.length} ledger event{ledger.length === 1 ? '' : 's'} stored.</p>}
          </section>
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
