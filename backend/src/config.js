const env = process.env;

export const config = {
  port: Number(env.PORT || 3000),
  databaseUrl: env.DATABASE_URL,
  password: env.APP_PASSWORD,
  tokenSecret: env.TOKEN_SECRET,
  corsOrigin: (env.CORS_ORIGIN || '*').split(',').map((s) => s.trim()),
  r2: {
    accountId: env.R2_ACCOUNT_ID,
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    bucket: env.R2_BUCKET,
  },
  maxFileBytes: Number(env.MAX_FILE_GB || 2) * 1024 ** 3,
  maxConcurrent: Number(env.MAX_CONCURRENT || 1),
  downloadDir: env.DOWNLOAD_DIR || '/tmp/torrents',
};

for (const [k, v] of Object.entries({
  DATABASE_URL: config.databaseUrl,
  APP_PASSWORD: config.password,
  TOKEN_SECRET: config.tokenSecret,
  R2_ACCOUNT_ID: config.r2.accountId,
  R2_ACCESS_KEY_ID: config.r2.accessKeyId,
  R2_SECRET_ACCESS_KEY: config.r2.secretAccessKey,
  R2_BUCKET: config.r2.bucket,
})) {
  if (!v) throw new Error(`Missing required env var ${k}`);
}
