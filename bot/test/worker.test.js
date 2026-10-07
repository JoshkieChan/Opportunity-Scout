const test = require('node:test');
const assert = require('node:assert/strict');
const { rankDeals, trustedUrl, parsePrice, reviewCount, validateProduct } = require('../logic');
const { loadConfig } = require('../config');
const { runCycle, sendAlert } = require('../index');
const ScoutAgent = require('../scout');

const config = { dryRun: true, maxTargets: 30, delayMs: 0, timeoutMs: 20, validatorUrl: 'http://validator/validate', channels: { A: 'priority', B: 'review' } };
const result = { approved: true, confidence: 100, tier: 'B', monthly_revenue: 100, monthly_profit: 100 };
const product = { title: '@everyone **Business**', price: 500, url: 'https://flippa.com/123', description: 'Monthly revenue: $100', reviews: 12 };

test('ranking uses score, then descending price without mutating input; returns top three', () => {
  const deals = [{ confidence: 90, price: 500 }, { confidence: 100, price: 100 }, { confidence: 90, price: 1000 }, { confidence: 70, price: 2000 }];
  const copy = [...deals];
  assert.deepEqual(rankDeals(deals), [deals[1], deals[2], deals[0]]);
  assert.deepEqual(deals, copy);
});

test('source allowlist rejects lookalikes, credentials, arbitrary ports and non-HTTPS', () => {
  for (const url of ['https://flippa.com/123', 'https://author.gumroad.com/l/a']) assert.ok(trustedUrl(url));
  for (const url of ['https://flippa.com.evil.com', 'https://evil.com/?gumroad.com', 'http://flippa.com', 'https://u:p@flippa.com', 'https://flippa.com:8443', 'file:///a']) assert.equal(trustedUrl(url), false);
});

test('price and explicit review parsing do not use arbitrary parenthesized numbers', () => {
  assert.equal(parsePrice('Price $1,234,567.89'), 1234567.89);
  assert.equal(parsePrice('$12,34'), null);
  assert.equal(parsePrice('$1.2K'), null);
  assert.equal(reviewCount('version (2026), 1,200 reviews'), 1200);
  assert.equal(reviewCount('version (2026)'), 0);
});

test('configuration supports credential-free dry runs and rejects missing credentials', () => {
  assert.equal(loadConfig({ DRY_RUN: 'true' }).dryRun, true);
  assert.throws(() => loadConfig({}), /required/);
  assert.throws(() => loadConfig({ DRY_RUN: 'true', HTTP_TIMEOUT_MS: '0' }), /Invalid/);
  assert.throws(() => loadConfig({ DRY_RUN: 'true', CYCLE_INTERVAL_MS: '2147483648' }), /Invalid/);
  assert.throws(() => loadConfig({ DRY_RUN: 'true', VALIDATOR_URL: 'file:///a' }), /Invalid/);
});

test('validator retries transient failure then succeeds', async () => {
  let calls = 0;
  const value = await validateProduct(product, config, { fetchImpl: async () => {
    calls++;
    return calls < 2 ? new Response('', { status: 503 }) : Response.json(result);
  } });
  assert.deepEqual(value, result);
  assert.equal(calls, 2);
});

test('invalid input is not retried', async () => {
  let calls = 0;
  assert.equal(await validateProduct(product, config, { fetchImpl: async () => { calls++; return new Response('', { status: 422 }); } }), null);
  assert.equal(calls, 1);
});

test('repeated network failures have a finite retry budget', async () => {
  let calls = 0;
  assert.equal(await validateProduct(product, config, { fetchImpl: async () => { calls++; throw new Error('offline'); } }), null);
  assert.equal(calls, 3);
});

test('malformed validator contract fails closed', async () => {
  for (const value of [{}, { ...result, tier: 'C' }, { ...result, confidence: 101 }, { ...result, monthly_profit: null }]) {
    assert.equal(await validateProduct(product, config, { fetchImpl: async () => Response.json(value) }), null);
  }
});

test('alert uses validator tier even for 100 confidence and disables mentions', async () => {
  let channelId;
  let message;
  const client = { channels: { fetch: async id => {
    channelId = id;
    return { isSendable: () => true, send: async value => { message = value; } };
  } } };
  await sendAlert(client, product, result, { ...config, dryRun: false });
  assert.equal(channelId, 'review');
  assert.deepEqual(message.allowedMentions, { parse: [] });
  assert.ok(!message.content.includes('@everyone'));
});

test('cycle continues after one listing fails and honors target budget', async () => {
  let calls = 0;
  const results = await runCycle({
    config: { ...config, maxTargets: 2 }, products: [product, product, product],
    validate: async () => { if (++calls === 1) throw new Error('offline'); return result; },
  });
  assert.equal(calls, 2);
  assert.equal(results.length, 1);
});

test('abort stops a cycle before processing listings', async () => {
  const controller = new AbortController();
  controller.abort();
  assert.deepEqual(await runCycle({ config, products: [product], signal: controller.signal }), []);
});

test('browser context closes when page creation fails', async () => {
  let closed = 0;
  const scout = new ScoutAgent({ logger: { warn() {} } });
  scout.browser = { isConnected: () => true, newContext: async () => ({
    route: async () => {}, newPage: async () => { throw new Error('closed'); }, close: async () => { closed++; },
  }) };
  assert.equal(await scout.scrapeUrl(product.url), null);
  assert.equal(closed, 1);
});

test('disconnected browser relaunches and close clears its reference', async () => {
  let launches = 0;
  let closed = 0;
  const scout = new ScoutAgent({ chromium: { launch: async () => { launches++; return { close: async () => { closed++; } }; } } });
  scout.browser = { isConnected: () => false };
  await scout.init();
  await scout.close();
  assert.equal(launches, 1);
  assert.equal(closed, 1);
  assert.equal(scout.browser, null);
});
