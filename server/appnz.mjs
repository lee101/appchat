import { config } from './config.mjs';

export function forwardedAuthHeaders(req) {
  const headers = {};
  const authorization = req.get('authorization');
  const cookie = req.get('cookie');
  if (authorization) headers.Authorization = authorization;
  if (cookie) headers.Cookie = cookie;
  return headers;
}

export async function appnzMe(req) {
  const res = await fetch(`${config.appnzBase}/api/me`, {
    headers: forwardedAuthHeaders(req)
  });
  if (!res.ok) return { authenticated: false };
  return res.json();
}

export async function appnzUsage(req) {
  const res = await fetch(`${config.appnzBase}/api/usage`, {
    headers: forwardedAuthHeaders(req)
  });
  const text = await res.text();
  if (!res.ok) {
    const err = new Error(text || `app.nz usage failed with ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return JSON.parse(text);
}

export async function spendCredits(req, amount, reason) {
  if (!amount || !config.appnzClientId || !config.appnzClientSecret) {
    return { success: true, charged: false, skipped: true };
  }
  const res = await fetch(`${config.appnzBase}/api/credits/spend`, {
    method: 'POST',
    headers: {
      ...forwardedAuthHeaders(req),
      'Content-Type': 'application/json',
      'X-App-Client-Id': config.appnzClientId,
      'X-App-Client-Secret': config.appnzClientSecret
    },
    body: JSON.stringify({ amount, reason })
  });
  const text = await res.text();
  let json = {};
  try {
    json = JSON.parse(text);
  } catch {
    json = { error: text };
  }
  if (!res.ok) {
    const err = new Error(json.error || `app.nz credit charge failed with ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return json;
}

export async function* demoChatStream(prompt) {
  const script = [
    'Autopilot linked in demo mode. ',
    'The route is viable if you keep the ship inside the amber gravity lanes. ',
    'I would burn one probe at the next junction, bank the crystal reward, ',
    'then ask the model router for a cheaper scout pass before the boss node.'
  ];
  if (/danger|risk|storm/i.test(prompt)) {
    script.splice(2, 0, 'Risk scan is elevated: shields first, loot second. ');
  }
  for (const token of script) {
    await new Promise((resolve) => setTimeout(resolve, 120));
    yield token;
  }
}

export async function* gatewayChatStream({ messages, model }) {
  if (!config.appnzApiKey) {
    yield* demoChatStream(messages.map((m) => m.content).join('\n'));
    return;
  }

  const res = await fetch(`${config.appnzBase}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.appnzApiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: model || config.defaultModel,
      messages,
      stream: true,
      stream_options: { include_usage: true },
      temperature: 0.7,
      max_tokens: 900
    })
  });
  if (!res.ok || !res.body) {
    const text = await res.text();
    throw new Error(text || `app.nz gateway failed with ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      try {
        const chunk = JSON.parse(payload);
        const delta = chunk.choices?.[0]?.delta?.content;
        if (delta) yield delta;
      } catch {
        // Keep streaming through harmless provider keep-alives or malformed tails.
      }
    }
  }
}
