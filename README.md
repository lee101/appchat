# AppChat

AppChat is a visual streaming AI chat game built to show how a real server app runs on app.nz:

- OpenAI-compatible streaming chat through the app.nz model router.
- Optional app.nz session/API-key auth lookup and usage dashboard calls.
- Postgres addon persistence through the injected `DATABASE_URL`.
- Optional first-party app credit charging with `/api/credits/spend`.
- Solana Pay-style prepaid credit quotes and transaction verification.
- Audio narration through the app.nz speech endpoint.

[![Deploy to app.nz](https://app.nz/deploy-button.svg)](https://app.nz/deploy?repo=https://github.com/lee101/appchat&name=appchat)

## Local Development

```bash
npm install
npm run build
npm start
```

Open `http://127.0.0.1:3000`. Without `APPNZ_API_KEY`, chat uses a deterministic demo stream so the UI and tests work before secrets are configured.

## app.nz Configuration

`appnz.yaml` is the deployment contract:

```yaml
runtime: server
run:
  command: npm start
  port: 3000
addons:
  - type: postgres
    plan: starter
secrets:
  - APPNZ_API_KEY
```

The Postgres addon injects `DATABASE_URL`. The app creates `appchat_runs` and `appchat_ledger` automatically on boot.

Deploy the server app from a checkout when your app.nz CLI exposes the server-app deploy surface:

```bash
app apps deploy appchat .
app apps env set appchat APPNZ_API_KEY=pk_live_...
app apps open appchat
```

Static assets are built into `dist/`; the Node server handles `/api/*` for chat, auth, usage, audio, and payments.

The currently published `appchat.app.nz` demo can also be deployed as a static site:

```bash
npm run build
app sites deploy appchat dist --title "AppChat"
```

In static-only mode the UI falls back to an in-browser demo stream. The server runtime is required for live model routing, Postgres, auth, audio, and Solana verification.

## Model Router

The default model is `appnz/auto-fast`. The UI also exposes `appnz/auto`, `appnz/auto-cheap`, and `openpaths/auto-fast`.

The server calls:

```http
POST https://app.nz/v1/chat/completions
Authorization: Bearer $APPNZ_API_KEY
Content-Type: application/json
```

with `stream: true`, then converts upstream chunks into browser SSE events. OpenAI documents streaming as server-sent events with `stream: true`: https://developers.openai.com/api/docs/guides/streaming-responses

## Auth And Credits

Browser cookies or a bearer token are forwarded to:

- `GET /api/me` for account status.
- `GET /api/usage` for model spend, server spend, and credit balance.
- `POST /api/credits/spend` when `APPNZ_APP_CLIENT_ID`, `APPNZ_APP_CLIENT_SECRET`, and `APPCHAT_ACTION_CREDITS` are set.

This keeps the demo usable anonymously while showing the exact production integration path for signed-in app.nz users.

## Solana Prepaid Credits

Set:

```bash
SOLANA_RECEIVER_ADDRESS=your_wallet
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
SOLANA_CREDITS_PER_SOL=100000
```

`POST /api/payments/solana/quote` returns a `solana:` URL with amount, memo, and reference. `POST /api/payments/solana/verify` checks the transaction against the configured receiver and reference. For local demos only:

```bash
SOLANA_ALLOW_DEV_CONFIRM=true
```

then verify with signature `dev-confirm`.

## VisualBench

Run the app, then capture desktop and mobile evidence:

```bash
npm run visualbench -- http://127.0.0.1:3000
```

Artifacts are written to `visualbench/`.

## Environment

Copy `.env.example` to `.env` for local work. In production, store secrets in app.nz and keep `.env` out of git.

## License

MIT
