// Run against preview/server.mjs; this writes only to the preview's temporary collection.
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const { chromium } = await import(process.env.BOOKS_PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, ...(process.env.BOOKS_BROWSER_EXECUTABLE ? { executablePath: process.env.BOOKS_BROWSER_EXECUTABLE } : {}) });
const marker = 'Pricing check ' + Date.now();
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [], saves = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (request.url().endsWith('/rpc') && request.postDataJSON()?.name === 'saveBook') saves.push(request.postDataJSON().arg); });
  // Pricing does not need the external barcode reader.
  await page.route('https://cdn.jsdelivr.net/**', route => route.abort());
  await page.goto(process.env.BOOKS_PREVIEW_URL || 'http://localhost:8765');
  await page.locator('#addButton').waitFor({ state: 'visible' });
  await page.waitForFunction(() => !document.getElementById('addButton').disabled);
  const collection = () => page.evaluate(() => rpc('getCollection'));
  const spend = data => data.books.reduce((sum, book) => sum + (Number(book.price) || 0), 0);
  const before = spend(await collection());
  await page.locator('#addButton').click();
  await page.locator('#series').fill(marker + ' calculated');
  await page.locator('#source').fill('Discount test shop');
  const base = page.locator('#regularPrice'), discount = page.locator('#discount'), type = page.locator('#discountType'), sale = page.locator('#price');
  const valid = () => page.locator('#bookForm').evaluate(form => form.checkValidity());
  assert.equal(await sale.inputValue(), '');
  await base.fill('175'); await discount.fill('15'); assert.equal(await sale.inputValue(), '148.75');
  await base.fill('19.99'); assert.equal(await sale.inputValue(), '16.99');
  await base.fill('10.075'); await discount.fill('0'); assert.equal(await sale.inputValue(), '10.08');
  await base.fill('0'); assert.equal(await sale.inputValue(), '0');
  await base.fill('200'); await discount.fill('100'); assert.equal(await sale.inputValue(), '0');
  for (const value of ['101', '-1']) {
    await discount.fill(value); assert.equal(await valid(), false);
    await page.locator('#saveButton').click(); assert.equal(saves.length, 0);
  }
  await discount.fill('15'); assert.equal(await valid(), true); assert.equal(await sale.inputValue(), '170');
  await type.selectOption('amount'); await discount.fill('30.25'); assert.equal(await sale.inputValue(), '169.75');
  await discount.fill('200'); assert.equal(await sale.inputValue(), '0');
  await discount.fill('201'); assert.equal(await valid(), false);
  await discount.fill('20'); assert.equal(await valid(), true);
  await base.fill(''); assert.equal(await valid(), false); assert.equal(await sale.inputValue(), '');
  await discount.fill(''); assert.equal(await valid(), true); assert.equal(await sale.inputValue(), '');
  await type.selectOption('percent'); await base.fill('200'); await discount.fill('15');
  await page.locator('#keepAdding').check();
  await page.locator('#saveButton').click();
  await page.waitForFunction(() => document.getElementById('bookDialog').open && document.getElementById('series').value === '' && !state.busy);
  assert.equal(saves[0].book.price, '170');
  assert.deepEqual(Object.keys(saves[0].book).sort(), ['isbn', 'series', 'type', 'publisher', 'status', 'volume', 'source', 'price', 'date', 'note'].sort());
  for (const field of [base, discount, sale]) assert.equal(await field.inputValue(), '');
  assert.equal(await type.inputValue(), 'percent');
  assert.equal(await page.locator('#source').inputValue(), 'Discount test shop');
  assert.ok(Math.abs(spend(await collection()) - before - 170) < 0.000001);
  console.log('PASS percent/amount discounts, rounding, validation, stored sale price and keep-adding reset');

  await page.locator('#keepAdding').uncheck();
  await page.locator('#series').fill(marker + ' direct');
  await base.fill('30'); await discount.fill('10'); assert.equal(await sale.inputValue(), '27');
  await sale.fill('24.95');
  await page.locator('#saveButton').click(); await page.waitForFunction(() => !document.getElementById('bookDialog').open && !state.busy);
  assert.equal(saves[1].book.price, '24.95');
  console.log('PASS directly entered sale price overrides the calculation when saving');

  for (const [suffix, price] of [['zero', '0'], ['unknown', '']]) {
    await page.locator('#addButton').click(); await page.locator('#series').fill(marker + ' ' + suffix); await sale.fill(price);
    await page.locator('#saveButton').click(); await page.waitForFunction(() => !document.getElementById('bookDialog').open && !state.busy);
    assert.equal((await collection()).books.find(book => book.series === marker + ' ' + suffix).price, price === '' ? '' : 0);
  }
  const saved = (await collection()).books.find(book => book.series === marker + ' calculated');
  await page.locator('#search').fill(saved.series);
  await page.locator('.series-row').click();
  await page.getByRole('button', { name: 'Edit ' + saved.series, exact: true }).click();
  assert.equal(await sale.inputValue(), '170'); assert.equal(await base.inputValue(), ''); assert.equal(await discount.inputValue(), '');
  await base.fill('199'); await type.selectOption('amount'); await discount.fill('49');
  await page.locator('#saveButton').click(); await page.waitForFunction(() => !document.getElementById('bookDialog').open && !state.busy);
  assert.equal((await collection()).books.find(book => book.series === saved.series).price, 150);
  assert.ok(Math.abs(spend(await collection()) - before - 174.95) < 0.000001);
  console.log('PASS zero versus unknown prices, editing an existing book and spending totals');

  for (const book of (await collection()).books.filter(book => book.series.startsWith(marker))) {
    await page.evaluate(book => rpc('removeBook', { requestId: crypto.randomUUID(), row: book.row, token: book.token }), book);
  }
  await page.locator('#backSeries').click(); await page.locator('#refreshButton').click();
  await page.waitForFunction(() => !document.getElementById('refreshButton').disabled);
  await page.locator('#addButton').click(); await base.fill('200'); await discount.fill('15');
  await page.locator('.purchase-price').scrollIntoViewIfNeeded();
  assert.equal(await page.locator('#bookDialog').evaluate(e => e.scrollWidth <= e.clientWidth), true);
  assert.equal(await page.locator('.purchase-price').evaluate(e => e.scrollWidth <= e.clientWidth), true);
  const footer = await page.locator('#saveButton').boundingBox(); assert.ok(footer.y >= 0 && footer.y + footer.height <= 844);
  await page.screenshot({ path: fileURLToPath(new URL('../outputs/pricing-preview.png', import.meta.url)) });
  await page.setViewportSize({ width: 1280, height: 900 });
  assert.equal(await page.locator('.purchase-price').evaluate(e => e.scrollWidth <= e.clientWidth), true);
  assert.deepEqual(errors, []);
  console.log('PASS phone/desktop layout, visible save button and no browser errors');
} finally {
  await browser.close();
}
