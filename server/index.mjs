import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { config, publicConfig } from './config.mjs';
import { addLedger, initDb, ledgerForUser, listRuns, saveRun } from './db.mjs';
import { activeAppnzAPIKey, appnzMe, appnzUsage, gatewayChatStream, spendCredits } from './appnz.mjs';
import { createSolanaQuote, verifySolanaPayment } from './solana.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');

const app = express();
app.use(express.json({ limit: '1mb' }));

const chatSchema = z.object({
  model: z.string().min(1).max(120).optional(),
  messages: z.array(z.object({
    role: z.enum(['system', 'developer', 'user', 'assistant']),
    content: z.string().min(1).max(6000)
  })).min(1).max(20)
});

function userIdFromMe(me) {
  return me?.authenticated && me?.user?.id ? String(me.user.id) : 'anonymous';
}

function sse(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

app.get('/api/config', (req, res) => {
  res.json(publicConfig());
});

app.get('/api/me', async (req, res) => {
  if (!req.get('cookie') && !req.get('authorization')) {
    res.json({ authenticated: false, demoMode: !config.appnzApiKey });
    return;
  }
  try {
    res.json(await appnzMe(req));
  } catch (error) {
    res.status(502).json({ authenticated: false, error: error.message });
  }
});

app.get('/api/usage', async (req, res) => {
  if (!req.get('cookie') && !req.get('authorization')) {
    res.json({
      demo: true,
      credits: { total: 4200, paid: 2000, free: 2200 },
      models: { costMicros: 12500, requests: 12 },
      servers: { count: 0 },
      totalCostUsd: 0.0125
    });
    return;
  }
  try {
    res.json(await appnzUsage(req));
  } catch (error) {
    res.status(error.status || 502).json({ error: error.message });
  }
});

app.get('/api/runs', async (req, res) => {
  const me = await safeMe(req);
  res.json({ runs: await listRuns(userIdFromMe(me)), ledger: await ledgerForUser(userIdFromMe(me)) });
});

app.post('/api/chat', async (req, res) => {
  const parsed = chatSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid chat request' });
    return;
  }

  const me = await safeMe(req);
  const userId = userIdFromMe(me);
  const model = parsed.data.model || config.defaultModel;
  const system = {
    role: 'system',
    content: [
      'You are AppChat, a compact streaming chat client for app.nz.',
      'Be concise, useful, and direct.',
      'When asked about deployment, auth, payments, or models, explain the relevant app.nz API route.'
    ].join(' ')
  };
  const state = {
    role: 'user',
    content: `Runtime context: app.nz server app, postgres=${Boolean(config.databaseUrl)}, solana=${Boolean(config.solanaReceiver)}`
  };
  const messages = [system, state, ...parsed.data.messages];
  const prompt = parsed.data.messages.map((m) => `${m.role}: ${m.content}`).join('\n');

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });

  let response = '';
  try {
    await spendCredits(req, config.actionCredits, 'appchat:chat');
    const apiKey = activeAppnzAPIKey(req);
    sse(res, 'meta', { model, demoMode: !apiKey, userId });
    for await (const token of gatewayChatStream({ messages, model, apiKey })) {
      response += token;
      sse(res, 'token', { text: token });
    }
    await saveRun({ userId, model, prompt, response, tokens: response.split(/\s+/).filter(Boolean).length });
    sse(res, 'done', { ok: true });
  } catch (error) {
    sse(res, 'error', { error: error.message });
  } finally {
    res.end();
  }
});

app.post('/api/audio/speech', async (req, res) => {
  const text = String(req.body?.text || '').trim().slice(0, 2000);
  if (!text) {
    res.status(400).json({ error: 'text is required' });
    return;
  }
  const apiKey = activeAppnzAPIKey(req);
  if (!apiKey) {
    res.status(503).json({ error: 'Set APPNZ_API_KEY to enable app.nz audio generation.' });
    return;
  }
  const upstream = await fetch(`${config.appnzBase}/v1/audio/speech`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: req.body?.model || 'appnz-tts',
      voice: req.body?.voice || 'eve',
      input: text
    })
  });
  if (!upstream.ok || !upstream.body) {
    res.status(upstream.status).send(await upstream.text());
    return;
  }
  res.setHeader('Content-Type', upstream.headers.get('content-type') || 'audio/mpeg');
  res.setHeader('Cache-Control', 'no-store');
  const reader = upstream.body.getReader();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    res.write(Buffer.from(value));
  }
  res.end();
});

app.post('/api/payments/solana/quote', async (req, res) => {
  try {
    const me = await safeMe(req);
    const credits = Math.max(100, Math.min(Number(req.body?.credits || 1000), 1_000_000));
    const quote = createSolanaQuote({ credits, userId: userIdFromMe(me) });
    await addLedger({ userId: userIdFromMe(me), kind: 'solana_quote', amount: credits, reference: quote.reference });
    res.json({ quote });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

app.post('/api/payments/solana/verify', async (req, res) => {
  try {
    const me = await safeMe(req);
    const result = await verifySolanaPayment({
      signature: String(req.body?.signature || ''),
      reference: String(req.body?.reference || ''),
      lamports: Number(req.body?.lamports || 0)
    });
    if (result.verified) {
      const amount = Math.max(0, Number(req.body?.credits || 0));
      await addLedger({ userId: userIdFromMe(me), kind: 'solana_credit', amount, reference: req.body.reference, signature: req.body.signature });
    }
    res.json(result);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

async function safeMe(req) {
  try {
    if (!req.get('cookie') && !req.get('authorization')) return { authenticated: false };
    return await appnzMe(req);
  } catch {
    return { authenticated: false };
  }
}

app.use(express.static(dist, { index: false }));
app.use((req, res) => {
  res.sendFile(path.join(dist, 'index.html'));
});

const db = await initDb();
const server = app.listen(config.port, () => {
  console.log(`appchat listening on http://127.0.0.1:${config.port} (${db.mode})`);
});

const keepalive = setInterval(() => {}, 1 << 30);

function shutdown() {
  clearInterval(keepalive);
  server.close(() => process.exit(0));
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
