import 'dotenv/config';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

export interface Config {
  token: string;
  clientId: string;
  devGuildId?: string;
  dbPath: string;
}

export function loadConfig(): Config {
  return {
    token: required('DISCORD_TOKEN'),
    clientId: required('DISCORD_CLIENT_ID'),
    devGuildId: process.env.DEV_GUILD_ID || undefined,
    dbPath: process.env.DB_PATH || './data/bot.db',
  };
}
