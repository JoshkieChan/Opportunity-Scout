function loadConfig(env = process.env) {
  function integer(name, fallback, minimum = 1) {
    const value = Number(env[name] ?? fallback);
    if (!Number.isSafeInteger(value) || value < minimum || value > 2147483647) throw new Error('Invalid ' + name);
    return value;
  }
  const validatorUrl = env.VALIDATOR_URL || 'http://127.0.0.1:8000/validate';
  const parsed = new URL(validatorUrl);
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error('Invalid VALIDATOR_URL');
  }
  const dryRun = env.DRY_RUN === 'true';
  const token = (env.DISCORD_TOKEN || '').trim();
  const channels = { A: env.CHANNEL_ID_PRIORITY, B: env.CHANNEL_ID_REVIEW };
  if (!dryRun && (!token || !channels.A || !channels.B)) {
    throw new Error('DISCORD_TOKEN, CHANNEL_ID_PRIORITY and CHANNEL_ID_REVIEW are required');
  }
  return {
    validatorUrl, dryRun, token, channels,
    once: env.RUN_ONCE === 'true',
    fixture: env.FIXTURE_PATH,
    timeoutMs: integer('HTTP_TIMEOUT_MS', 10000),
    intervalMs: integer('CYCLE_INTERVAL_MS', 600000),
    delayMs: integer('REQUEST_DELAY_MS', 2000, 0),
    maxTargets: integer('MAX_TARGETS_PER_CYCLE', 30),
  };
}
module.exports = { loadConfig };
