const { setTimeout: sleep } = require('node:timers/promises');
const { readFile } = require('node:fs/promises');
const { loadConfig } = require('./config');
const { rankDeals, validateProduct } = require('./logic');
const ScoutAgent = require('./scout');

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
    const products = config.fixture ? JSON.parse(await readFile(config.fixture, 'utf8')) : undefined;
    if (products && (!Array.isArray(products) || !config.dryRun)) {
      throw new Error('Fixtures require a product array and DRY_RUN=true');
    }
    if (!config.dryRun) {
      const { Client, GatewayIntentBits, Events } = require('discord.js');
      client = new Client({ intents: [GatewayIntentBits.Guilds], rest: { timeout: config.timeoutMs } });
      client.on('error', () => console.warn('[DISCORD] Connection error'));
      const ready = new Promise(resolve => client.once(Events.ClientReady, resolve));
      await client.login(config.token);
      await Promise.race([
        ready,
        sleep(30000, undefined, { signal: controller.signal }).then(() => { throw new Error('Discord readiness timeout'); }),
      ]);
    }
    do {
      await runCycle({ scout, client, config, signal: controller.signal, products });
      if (!config.once) await sleep(config.intervalMs, undefined, { signal: controller.signal }).catch(() => {});
    } while (!config.once && !controller.signal.aborted);
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
module.exports = { runCycle, sendAlert, main };
