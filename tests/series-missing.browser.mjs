// All RPCs use an isolated harness; this check never changes the preview or a live sheet.
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createHarness } from './gas-harness.mjs';
const { chromium } = await import(process.env.BOOKS_PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, ...(process.env.BOOKS_BROWSER_EXECUTABLE ? { executablePath: process.env.BOOKS_BROWSER_EXECUTABLE } : {}) });
const title = 'ดอกรักผลิบานที่กลางใจ', other = 'A different shelf';
const base = { series: title, type: 'Manga (TH)', publisher: 'PHOENIX Next', status: 'Read', source: 'Thai shop', date: '2026-09-01' };
const h = createHarness([
  { ...base, volume: 2, isbn: '0140328726' }, { ...base, volume: 4 }, { ...base, volume: 4 }, { ...base, volume: 4.5 }, { ...base, volume: 0 },
  { ...base, volume: 1, type: 'Manga (JP)', publisher: 'Kodansha', source: 'Japanese shop', date: '2026-10-01' },
  { ...base, volume: 3, type: 'Manga (JP)', publisher: 'Kodansha', source: 'Japanese shop', date: '2026-10-01' },
  { ...base, volume: 1, type: 'LN (TH)' }, { ...base, volume: 3, type: 'LN (TH)' },
  { ...base, series: other, publisher: 'Kodansha', volume: 1 }, { ...base, series: other, publisher: 'Kodansha', volume: 2 },
  { ...base, series: 'Unnumbered story', type: 'Other', publisher: '', volume: '' },
  { ...base, series: 'Large sequence', type: 'Other', publisher: '', volume: 1000000 }
]);
h.setup();
const item = (volume, type = 'Manga (TH)', extra = {}) => ({ ...h.api.releaseItem_('phoenix', title + ' เล่ม ' + volume, 'https://www.phoenixnext.com/missing-' + type.slice(0, 2) + '-' + volume + '.html', 175, '', type), ...extra });
const next = item(5), preorder = item(6, 'Manga (TH)', { availability: 'Pre-order' }), decimal = item(5.5);
const possible = item(4), owned = item(2, 'Manga (TH)', { isbn: '9780140328721' }), novel = item(4, 'LN (TH)');
const special = item(5, 'Manga (TH)', { id: 'phoenix:special-check', title: title + ' Special set', special: true });
const wrongLanguage = item(8, 'Manga (JP)'), unrelated = { ...item(9), series: other, title: other + ' เล่ม 9' };
let feeds = { phoenix: [next, preorder, decimal, possible, owned, novel, special, wrongLanguage, unrelated], firstpage: [], luckpim: [] };
let releaseGate;
const gated = new Promise(resolve => { releaseGate = resolve; });
let delayFeeds = true, failPhoenix = false, failSave = false, failShelf = false, feedCalls = [];
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } }), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('https://cdn.jsdelivr.net/**', route => route.abort());
  await page.route('**/rpc', async route => {
    const { name, arg } = route.request().postDataJSON();
    if (name === 'getPublisherReleases') {
      feedCalls.push(arg);
      if (delayFeeds) await gated;
      if (failPhoenix && arg.publisherId === 'phoenix') return route.fulfill({ status: 503, json: { message: 'Test outage' } });
      return route.fulfill({ json: { publisherId: arg.publisherId, items: feeds[arg.publisherId], checkedAt: '2026-10-09T07:00:00Z', stale: false, error: '' } });
    }
    if ((failSave && name === 'setSavedRelease') || (failShelf && name === 'getCollection')) return route.fulfill({ status: 503, json: { message: 'Test save or shelf outage' } });
    try { return await route.fulfill({ json: h.api[name](arg) }); }
    catch (error) { return route.fulfill({ status: 400, json: { message: error.message } }); }
  });
  await page.goto(process.env.BOOKS_PREVIEW_URL || 'http://localhost:8765');
  await page.waitForFunction(() => !!state.data);
  await page.locator('#search').fill(title); await page.locator('#typeFilter').selectOption('Manga (TH)');
  await page.locator('.series-row').click();
  assert.equal(await page.locator('#seriesMissing').isVisible(), true);
  assert.equal(await page.locator('#typeFilter').inputValue(), '');
  assert.equal(await page.locator('.book-row').count(), 9);
  assert.match(await page.locator('#seriesMissingSummary').textContent(), /4 gaps/);
  assert.match(await page.locator('#seriesReleaseStatus').textContent(), /Checking/);
  const edition = type => page.locator('.missing-edition').filter({ has: page.getByRole('heading', { name: type + ' · ' + (type === 'Manga (JP)' ? 'Kodansha' : 'PHOENIX Next'), exact: true }) });
  assert.deepEqual(await edition('Manga (TH)').locator('.missing-volume').allTextContents(), ['Vol. 1 +', 'Vol. 3 +']);
  assert.deepEqual(await edition('Manga (JP)').locator('.missing-volume').allTextContents(), ['Vol. 2 +']);
  assert.deepEqual(await edition('LN (TH)').locator('.missing-volume').allTextContents(), ['Vol. 2 +']);
  console.log('PASS immediate shelf gaps, duplicate/zero/decimal handling, separate languages and formats, all owned volumes');

  // Navigate away while requests are outstanding: arriving feeds must follow the current series.
  await page.locator('#backSeries').click(); await page.locator('#search').fill(other); await page.locator('.series-row').click();
  releaseGate(); delayFeeds = false;
  await page.waitForFunction(() => state.releasesLoaded && !state.releasesLoading);
  assert.equal(await page.locator('#seriesReleaseList .release-card').count(), 0);
  assert.match(await page.locator('#seriesGaps').textContent(), /No gaps through volume 2/);
  assert.match(await page.locator('#seriesReleaseStatus').textContent(), /available for Phoenix/);
  await page.locator('#backSeries').click(); await page.locator('#search').fill(title); await page.locator('.series-row').click();
  assert.equal(feedCalls.length, 3);
  assert.equal(await page.locator('#seriesReleaseList .release-card').count(), 5);
  assert.match(await page.locator('#seriesMissingSummary').textContent(), /4 gaps.*5 recent listings/);
  assert.equal(await page.locator('#seriesReleaseReview').isVisible(), true);
  assert.equal(await page.locator('#seriesReleaseReviewList .release-card').count(), 1);
  assert.equal(await page.locator('#seriesReleaseReviewList').isVisible(), false);
  await page.locator('#seriesReleaseReview summary').click();
  assert.match(await page.locator('#seriesReleaseReviewList').textContent(), /Check the edition/);
  const card = title => page.locator('#seriesReleaseList .release-card').filter({ has: page.getByRole('heading', { name: title, exact: true }) });
  assert.match(await card(preorder.title).textContent(), /Pre-order/);
  assert.match(await card(special.title).textContent(), /Special edition/);
  assert.equal(await card(owned.title).count(), 0); assert.equal(await card(wrongLanguage.title).count(), 0); assert.equal(await card(unrelated.title).count(), 0);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.locator('#seriesReleaseReview summary').click();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: fileURLToPath(new URL('../outputs/series-missing-phone.png', import.meta.url)) });
  await page.setViewportSize({ width: 1280, height: 900 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: fileURLToPath(new URL('../outputs/series-missing-desktop.png', import.meta.url)), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  console.log('PASS automatic release checks, cached navigation, pending-series changes, exact ownership, edition review, pre-orders and special sets');

  // The most recent owned edition is Japanese; a Thai gap must retain the Thai edition and shop.
  await edition('Manga (TH)').getByRole('button', { name: /Add missing volume 1/ }).click();
  assert.equal(await page.locator('#volume').inputValue(), '1');
  assert.equal(await page.locator('#type').inputValue(), 'Manga (TH)');
  assert.equal(await page.locator('#publisher').inputValue(), 'PHOENIX Next');
  assert.equal(await page.locator('#source').inputValue(), 'Thai shop');
  assert.equal(await page.locator('#isbn').inputValue(), '');
  await page.locator('#saveButton').click();
  await page.waitForFunction(() => !document.getElementById('bookDialog').open && !state.busy && document.getElementById('seriesMissingSummary').textContent.startsWith('3 gaps'));
  assert.deepEqual(await edition('Manga (TH)').locator('.missing-volume').allTextContents(), ['Vol. 3 +']);
  assert.equal(h.api.getCollection().books.filter(b => b.series === title && b.volume === 1 && b.type === 'Manga (TH)').length, 1);
  console.log('PASS filling a gap preserves its edition and shop, saves once, and immediately updates the missing summary');

  failSave = true;
  await card(next.title).getByRole('button', { name: 'Save for later', exact: true }).click();
  await page.waitForFunction(() => !state.savingReleases.size);
  assert.equal(await page.locator('#seriesReleaseError').isVisible(), true);
  assert.match(await page.locator('#seriesReleaseError').textContent(), /Test save/);
  failSave = false;
  const before = h.api.getCollection().books.length;
  await card(next.title).getByRole('button', { name: 'Save for later', exact: true }).click();
  await page.waitForFunction(() => !state.savingReleases.size);
  assert.equal(h.api.getCollection().books.length, before);
  assert.equal(await card(next.title).getByRole('button', { name: 'Saved · Unsave' }).getAttribute('aria-pressed'), 'true');
  await card(next.title).getByRole('button', { name: 'Add to shelf', exact: true }).click();
  assert.equal(await page.locator('#volume').inputValue(), '5'); assert.equal(await page.locator('#type').inputValue(), 'Manga (TH)');
  await page.locator('#saveButton').click();
  await page.waitForFunction(() => !document.getElementById('bookDialog').open && !state.busy && document.getElementById('seriesMissingSummary').textContent.includes('4 recent listings'));
  assert.equal(await card(next.title).count(), 0);
  assert.equal(await page.locator('#seriesReleaseReviewList .release-card').count(), 2);
  console.log('PASS in-series save errors, saved-list actions, reviewed release additions and ownership updates');

  failPhoenix = true; failShelf = true;
  await page.locator('#refreshSeriesReleases').click();
  await page.waitForFunction(() => !state.releasesLoading);
  assert.match(await page.locator('#seriesReleaseStatus').textContent(), /unavailable/);
  assert.match(await page.locator('#seriesReleaseSources').textContent(), /Previous check.*Unable to check Phoenix/s);
  assert.match(await page.locator('#seriesReleaseError').textContent(), /Unable to refresh your shelf/);
  assert.equal(await page.locator('#seriesReleaseList .release-card').count(), 4);
  assert.ok(feedCalls.slice(-3).every(call => call.refresh));
  failPhoenix = false; failShelf = false;
  feeds.phoenix = [owned, possible];
  await page.locator('#refreshSeriesReleases').click(); await page.waitForFunction(() => !state.releasesLoading);
  assert.match(await page.locator('#seriesReleaseStatus').textContent(), /No missing volumes found in these recent listings/);
  await page.setViewportSize({ width: 1280, height: 900 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  console.log('PASS stale feeds and shelf errors remain visible, refresh recovers, phone and desktop fit');

  for (const [series, expected] of [['Unnumbered story', /No numbered sequence/], ['Large sequence', /Missing 999,999 volumes/]]) {
    await page.locator('#backSeries').click(); await page.locator('#search').fill(series); await page.locator('.series-row').click();
    assert.match(await page.locator('#seriesGaps').textContent(), expected);
  }
  assert.equal(await page.locator('.missing-volume').count(), 1);
  assert.match(await page.locator('.missing-volume').textContent(), /1–999999/);
  assert.deepEqual(errors, []);
  console.log('PASS unnumbered-only series, bounded rendering for large volume gaps and no browser errors');
} finally { releaseGate(); await browser.close(); }
