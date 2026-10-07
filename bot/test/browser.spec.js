const test = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const ScoutAgent = require('../scout');

test('real Chromium extracts a listing from fixture HTML and closes its context', async () => {
  const browser = await chromium.launch({ headless: true });
  const createContext = browser.newContext.bind(browser);
  browser.newContext = async (...args) => {
    const context = await createContext(...args);
    context.on('page', page => {
      void page.route('**/*', route => route.fulfill({
        contentType: 'text/html',
        body: '<title>Example SaaS</title><meta property="product:price:amount" content="850"><meta property="product:price:currency" content="USD"><body>12 reviews. Monthly revenue: $1,200. Monthly profit: $400.</body>',
      }));
    });
    return context;
  };
  const scout = new ScoutAgent({ chromium: { launch: async () => browser } });
  try {
    const product = await scout.scrapeUrl('https://flippa.com/fixture');
    assert.equal(product.title, 'Example SaaS');
    assert.equal(product.price, 850);
    assert.equal(product.reviews, 12);
    assert.match(product.description, /Monthly revenue/);
    assert.equal(browser.contexts().length, 0);
  } finally {
    await scout.close();
  }
});
