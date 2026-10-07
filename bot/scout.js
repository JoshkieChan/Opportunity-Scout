const { trustedUrl, parsePrice, reviewCount } = require('./logic');

class ScoutAgent {
  constructor({ chromium, logger = console } = {}) {
    this.chromium = chromium;
    this.logger = logger;
    this.browser = null;
    this.stopped = false;
  }

  async init() {
    if (this.stopped) throw new Error('Scout stopped');
    if (!this.browser?.isConnected()) {
      this.browser = await (this.chromium || require('playwright').chromium).launch({ headless: true });
      if (this.stopped) {
        await this.close();
        throw new Error('Scout stopped');
      }
    }
  }

  async withPage(action, fallback) {
    let context;
    try {
      await this.init();
      context = await this.browser.newContext();
      // Only navigate main documents on supported marketplaces, including redirects.
      await context.route('**/*', route => {
        const request = route.request();
        if (request.isNavigationRequest() && !trustedUrl(request.url())) return route.abort();
        return route.continue();
      });
      const page = await context.newPage();
      page.setDefaultTimeout(15000);
      page.setDefaultNavigationTimeout(30000);
      return await action(page);
    } catch {
      this.logger.warn('[SCOUT] Browser or marketplace request failed');
      return fallback;
    } finally {
      await context?.close().catch(() => {});
    }
  }

  async scrapeUrl(url) {
    if (!trustedUrl(url)) return null;
    return this.withPage(async page => {
      const response = await page.goto(url, { waitUntil: 'domcontentloaded' });
      if (!response?.ok()) return null;
      const title = (await page.title()).trim().slice(0, 500);
      const description = (await page.locator('body').innerText()).slice(0, 50000);
      // Prefer explicit product-price metadata; body-text fallback is intentionally heuristic.
      const metadata = await page.locator('meta[property="product:price:amount"]').first().getAttribute('content', { timeout: 1000 }).catch(() => null);
      const currency = await page.locator('meta[property="product:price:currency"]').first().getAttribute('content', { timeout: 1000 }).catch(() => null);
      if (currency && currency.toUpperCase() !== 'USD') return null;
      const price = metadata && /^[0-9]+(?:[.][0-9]{1,2})?$/.test(metadata)
        ? Number(metadata) : parsePrice(description);
      if (!title || !Number.isFinite(price) || price <= 0) return null;
      return { title, price, description, reviews: reviewCount(description), url: page.url() };
    }, null);
  }

  async discover(source) {
    const urls = new Set();
    for (const keyword of ['saas', 'plugin', 'business']) {
      const search = source === 'flippa'
        ? 'https://flippa.com/search?filter%5Bprice%5D%5Bmax%5D=1000&q=' + keyword
        : 'https://gumroad.com/discover?query=' + keyword;
      const found = await this.withPage(async page => {
        const response = await page.goto(search, { waitUntil: 'domcontentloaded' });
        if (!response?.ok()) return [];
        const selector = source === 'flippa' ? 'a.GTM-search-result-card' : 'a[href*="/l/"]';
        await page.locator(selector).first().waitFor({ timeout: 10000 });
        return page.locator(selector).evaluateAll(nodes => nodes.map(node => node.href));
      }, []);
      for (const url of found) if (trustedUrl(url)) urls.add(url.split('#')[0]);
    }
    return [...urls];
  }

  discoverFlippa() { return this.discover('flippa'); }
  discoverGumroad() { return this.discover('gumroad'); }

  async close() {
    this.stopped = true;
    const browser = this.browser;
    this.browser = null;
    await browser?.close();
  }
}
module.exports = ScoutAgent;
