import { chromium } from '@playwright/test';
import { readFile } from 'node:fs/promises';
const password = (await readFile('.env', 'utf8')).match(/^DASHBOARD_PASSWORD=(.+)$/m)?.[1];
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
try {
  await page.goto('http://127.0.0.1:3000');
  await page.getByLabel('Dashboard password').fill(password);
  await page.getByRole('button', { name: 'Enter mission control' }).click();
  await page
    .getByRole('button')
    .filter({ hasText: 'Codex Home integration verification' })
    .first()
    .click();
  await page.getByRole('button', { name: 'Approve once', exact: true }).waitFor();
  await page.screenshot({ path: '.data/screenshots/approval.png', fullPage: true });
  // Explicitly reviewed smoke-only command request. No automatic approval loop.
  await page.getByRole('button', { name: 'Approve once', exact: true }).click();
  console.log('Reviewed integration request approved through the real dashboard.');
} finally {
  await browser.close();
}
