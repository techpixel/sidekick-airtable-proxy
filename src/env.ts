function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(`Missing required environment variable: ${name}`);
    process.exit(1);
  }
  return value;
}

function optional(name: string, fallback: string): string {
  return process.env[name]?.trim() || fallback;
}

export const env = {
  sidekickSecret: required("SIDEKICK_SECRET"),
  airtableApiKey: required("AIRTABLE_API_KEY"),
  airtableBaseId: optional("AIRTABLE_BASE_ID", "app9SfJm8LOTJKm0A"),
  airtableTableId: optional("AIRTABLE_TABLE_ID", "tbllB2MlHnfep54wK"),
  airtableUsersTableId: optional("AIRTABLE_USERS_TABLE_ID", "tblLsdMMbx5T5L9S2"),
  statsApiKey: process.env.STATS_API_KEY?.trim() || null,
  slackBotToken: process.env.SLACK_BOT_TOKEN?.trim() || null,
  hackatimeBaseUrl: optional("HACKATIME_BASE_URL", "https://hackatime.hackclub.com"),
  port: Number(optional("PORT", "3000")),
  cacheTtlMs: Number(optional("CACHE_TTL_MS", "60000")),
};
