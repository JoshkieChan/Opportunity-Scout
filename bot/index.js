const { setTimeout: sleep } = require('node:timers/promises');
const { readFile } = require('node:fs/promises');
const { loadConfig } = require('./config');
const { rankDeals, validateProduct } = require('./logic');
const ScoutAgent = require('./scout');

function parseFixtures(content, dryRun) {
  const products = JSON.parse(content);
  if (!dryRun || !Array.isArray(products)) {
    throw new Error('Fixtures require a product array and DRY_RUN=true');
  }
  return products;
}

async function connectDiscord(client, token, signal, timeoutMs = 30000) {
  const timer = new AbortController();
  let onReady;
  const ready = new Promise(resolve => { onReady = resolve; client.once('clientReady', onReady); });
  try {
    await Promise.race([
      Promise.all([ready, client.login(token)]),
      sleep(timeoutMs, undefined, { signal: AbortSignal.any([signal, timer.signal]) })
        .then(() => { throw new Error('Discord readiness timeout'); }),
    ]);
  } finally {
    timer.abort();
    client.removeListener('clientReady', onReady);
  }
}

function plain(value) {
  return String(value).replace(/[*_`~|<>@]/g, '').slice(0, 200);
}

async function sendAlert(client, product, result, config) {
  if (!result.approved) return;
  if (config.dryRun) {
    console.log('[DRY RUN] Tier ' + result.tier + ', score ' + result.confidence);
    return;
  }
  const channel = await client.channels.fetch(config.channels[result.tier]);
  if (!channel?.isSendable()) throw new Error('Channel is not sendable');
  await channel.send({
    content: '**TIER ' + result.tier + ' OPPORTUNITY**\n' + plain(product.title) +
      '\nPrice: $' + product.price + ' | Heuristic score: ' + result.confidence +
      '\nClaimed monthly revenue: $' + result.monthly_revenue +
      '\nClaimed monthly profit: $' + result.monthly_profit + '\n' + product.url.slice(0, 1000),
    allowedMentions: { parse: [] },
  });
}

async function runCycle({ scout, client, config, signal, products, validate = validateProduct }) {
  const results = [];
  if (signal?.aborted) return results;
  const targets = products || [...new Set([
    ...await scout.discoverFlippa(), ...await scout.discoverGumroad(),
  ])];
  for (const target of targets.slice(0, config.maxTargets)) {
    if (signal?.aborted) break;
    try {
      const product = products ? target : await scout.scrapeUrl(target);
      if (!product) continue;
      const result = await validate(product, config, { signal });
      if (result?.approved) {
        results.push({ ...product, ...result });
        await sendAlert(client, product, result, config);
      }
    } catch {
      console.warn('[WORKER] Listing or alert failed');
    }
    if (config.delayMs) await sleep(config.delayMs, undefined, { signal }).catch(() => {});
  }
  if (results.length && !config.dryRun && !signal?.aborted) {
    try {
      const channel = await client.channels.fetch(config.channels.A);
      await channel.send({
        content: '**TOP OPPORTUNITIES THIS CYCLE**\n' + rankDeals(results)
          .map((deal, i) => (i + 1) + '. ' + plain(deal.title) + ' | $' + deal.price +
            ' | Score ' + deal.confidence + '\n' + deal.url.slice(0, 300)).join('\n'),
        allowedMentions: { parse: [] },
      });
    } catch {
      console.warn('[WORKER] Summary delivery failed');
    }
  }
  console.log('[WORKER] Cycle complete; approved=' + results.length);
  return results;
}

async function main() {
  require('dotenv').config({ quiet: true });
  const config = loadConfig();
  const scout = new ScoutAgent();
  const controller = new AbortController();
  let client;
  const shutdown = () => {
    controller.abort();
    void scout.close().catch(() => {});
    client?.destroy();
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  try {
    const products = config.fixture
      ? parseFixtures(await readFile(config.fixture, 'utf8'), config.dryRun) : undefined;
    if (!config.dryRun) {
      const { Client, GatewayIntentBits } = require('discord.js');
      client = new Client({ intents: [GatewayIntentBits.Guilds], rest: { timeout: config.timeoutMs } });
      client.on('error', () => console.warn('[DISCORD] Connection error'));
      await connectDiscord(client, config.token, controller.signal);
    }
    do {
      await runCycle({ scout, client, config, signal: controller.signal, products });
      if (!config.once) await sleep(config.intervalMs, undefined, { signal: controller.signal }).catch(() => {});
    } while (!config.once && !controller.signal.aborted);
  } catch (error) {
    if (!controller.signal.aborted) throw error;
  } finally {
    controller.abort();
    await scout.close().catch(() => {});
    client?.destroy();
    process.removeListener('SIGINT', shutdown);
    process.removeListener('SIGTERM', shutdown);
  }
}

if (require.main === module) {
  main().catch(() => {
    console.error('[WORKER] Startup or runtime failure; check configuration and service availability');
    process.exitCode = 1;
  });
}
module.exports = { runCycle, sendAlert, main, parseFixtures, connectDiscord };
