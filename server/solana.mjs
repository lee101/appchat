import { randomBytes } from 'node:crypto';
import { config } from './config.mjs';

const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function base58Encode(bytes) {
  let n = BigInt(`0x${Buffer.from(bytes).toString('hex') || '0'}`);
  let out = '';
  while (n > 0n) {
    const mod = Number(n % 58n);
    out = alphabet[mod] + out;
    n /= 58n;
  }
  for (const byte of bytes) {
    if (byte === 0) out = '1' + out;
    else break;
  }
  return out || '1';
}

function assertSolanaAddress(value, label) {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value)) {
    const err = new Error(`${label} must be a base58 Solana address`);
    err.status = 400;
    throw err;
  }
  return value;
}

export function createSolanaQuote({ credits = 1000, userId = 'anonymous' }) {
  if (!config.solanaReceiver) {
    const err = new Error('SOLANA_RECEIVER_ADDRESS is not configured');
    err.status = 503;
    throw err;
  }
  const receiver = assertSolanaAddress(config.solanaReceiver, 'SOLANA_RECEIVER_ADDRESS');
  const reference = base58Encode(randomBytes(32));
  const sol = Math.max(credits / config.solanaCreditsPerSol, 0.000001);
  const label = 'AppChat credits';
  const memo = `appchat:${userId}:${credits}`;
  const params = new URLSearchParams({
    amount: sol.toFixed(9).replace(/0+$/, '').replace(/\.$/, ''),
    label,
    message: `${credits} AppChat credits`,
    memo,
    reference
  });
  return {
    credits,
    sol,
    lamports: Math.round(sol * 1_000_000_000),
    receiver,
    reference,
    memo,
    url: `solana:${receiver}?${params.toString()}`,
    cluster: config.solanaCluster
  };
}

async function rpc(method, params) {
  const res = await fetch(config.solanaRpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 'appchat', method, params })
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || 'Solana RPC error');
  return json.result;
}

export async function verifySolanaPayment({ signature, reference, lamports }) {
  if (config.solanaAllowDevConfirm && signature === 'dev-confirm') {
    return { verified: true, mode: 'dev' };
  }
  if (!signature || !reference || !lamports) {
    const err = new Error('signature, reference, and lamports are required');
    err.status = 400;
    throw err;
  }
  const tx = await rpc('getTransaction', [
    signature,
    { encoding: 'jsonParsed', commitment: 'confirmed', maxSupportedTransactionVersion: 0 }
  ]);
  if (!tx?.transaction?.message?.accountKeys) return { verified: false, reason: 'transaction not found' };

  const accountKeys = tx.transaction.message.accountKeys.map((a) => (typeof a === 'string' ? a : a.pubkey));
  if (!accountKeys.includes(reference)) return { verified: false, reason: 'reference not found' };
  if (config.solanaReceiver && !accountKeys.includes(config.solanaReceiver)) {
    return { verified: false, reason: 'receiver not found' };
  }

  const receiverIndex = accountKeys.indexOf(config.solanaReceiver);
  const pre = tx.meta?.preBalances?.[receiverIndex] || 0;
  const post = tx.meta?.postBalances?.[receiverIndex] || 0;
  const delta = post - pre;
  if (delta < lamports) return { verified: false, reason: `received ${delta}, expected ${lamports}` };
  return { verified: true, signature, receivedLamports: delta };
}
