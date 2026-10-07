// Runs inside the worker container or against a locally running validator.
const assert = require('node:assert/strict');
const { validateProduct } = require('../bot/logic');
const products = require('../fixtures/products.json');
(async () => {
  const url = process.env.VALIDATOR_URL || 'http://127.0.0.1:8000/validate';
  const results = [];
  for (const product of products) {
    const result = await validateProduct(product, { validatorUrl: url, timeoutMs: 5000 });
    assert.ok(result, 'Validator did not return a valid response');
    results.push(result);
  }
  assert.deepEqual(results.map(result => result.tier), ['A', 'B', 'C']);
  console.log('Node -> FastAPI HTTP smoke passed: tiers A, B, C');
})().catch(error => { console.error(error.message); process.exitCode = 1; });
