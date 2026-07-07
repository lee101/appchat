export const config = {
  port: Number(process.env.PORT || 3000),
  publicUrl: (process.env.APPCHAT_PUBLIC_URL || 'http://127.0.0.1:3000').replace(/\/$/, ''),
  appnzBase: (process.env.APPNZ_API_BASE || 'https://app.nz').replace(/\/$/, ''),
  appnzApiKey: process.env.APPNZ_API_KEY || '',
  appnzClientId: process.env.APPNZ_APP_CLIENT_ID || '',
  appnzClientSecret: process.env.APPNZ_APP_CLIENT_SECRET || '',
  actionCredits: Number(process.env.APPCHAT_ACTION_CREDITS || 0),
  defaultModel: process.env.APPCHAT_DEFAULT_MODEL || 'appnz/auto-fast',
  databaseUrl: process.env.DATABASE_URL || '',
  solanaReceiver: process.env.SOLANA_RECEIVER_ADDRESS || '',
  solanaCluster: process.env.SOLANA_CLUSTER || 'mainnet-beta',
  solanaRpcUrl: process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
  solanaCreditsPerSol: Number(process.env.SOLANA_CREDITS_PER_SOL || 100000),
  solanaAllowDevConfirm: process.env.SOLANA_ALLOW_DEV_CONFIRM === 'true'
};

export function publicConfig() {
  return {
    appName: 'AppChat',
    publicUrl: config.publicUrl,
    appnzBase: config.appnzBase,
    defaultModel: config.defaultModel,
    demoMode: !config.appnzApiKey,
    postgresEnabled: Boolean(config.databaseUrl),
    solanaEnabled: Boolean(config.solanaReceiver),
    actionCredits: config.actionCredits
  };
}
