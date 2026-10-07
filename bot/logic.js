function rankDeals(results) {
  return [...results].sort((a, b) => b.confidence - a.confidence || b.price - a.price).slice(0, 3);
}

function trustedUrl(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return url.protocol === 'https:' && !url.username && !url.password && !url.port &&
      ['flippa.com', 'gumroad.com'].some(domain => host === domain || host.endsWith('.' + domain));
  } catch {
    return false;
  }
}

function parsePrice(text) {
  const match = text?.match(/\$\s*((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?)(?![\d,.kKmM])/);
  return match ? Number(match[1].replaceAll(',', '')) : null;
}

function reviewCount(text) {
  const match = text.match(/\b([\d,]+)\s+(?:reviews|ratings)\b/i);
  return match ? Number(match[1].replaceAll(',', '')) : 0;
}

function validResult(value) {
  return value && typeof value.approved === 'boolean' &&
    Number.isInteger(value.confidence) && value.confidence >= 0 && value.confidence <= 100 &&
    ['A', 'B', 'C'].includes(value.tier) && value.approved === (value.tier !== 'C') &&
    ['monthly_revenue', 'monthly_profit'].every(key => Number.isFinite(value[key]) && value[key] >= 0);
}

async function validateProduct(product, config, { fetchImpl = fetch, signal } = {}) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const timeout = AbortSignal.timeout(config.timeoutMs);
      const response = await fetchImpl(config.validatorUrl, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(product),
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
      if (response.status === 429 || response.status >= 500) {
        await response.body?.cancel();
        throw new Error('Transient validator failure');
      }
      if (!response.ok) {
        await response.body?.cancel();
        return null;
      }
      const result = await response.json();
      return validResult(result) ? result : null;
    } catch {
      if (signal?.aborted || attempt === 2) return null;
      await new Promise(resolve => setTimeout(resolve, 100 * 2 ** attempt));
    }
  }
}

module.exports = { rankDeals, trustedUrl, parsePrice, reviewCount, validResult, validateProduct };
