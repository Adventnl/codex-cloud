import { chromium } from '@playwright/test';
import { readFile, mkdir } from 'node:fs/promises';
const password = (await readFile('.env', 'utf8')).match(/^DASHBOARD_PASSWORD=(.+)$/m)?.[1];
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const failures = [];
page.on('pageerror', (error) => failures.push(error.message));
try {
  await page.goto('http://127.0.0.1:3000');
  await page.getByLabel('Dashboard password').fill(password);
  await page.getByRole('button', { name: 'Enter mission control' }).click();
  await page.getByRole('heading', { name: 'MISSION CONTROL' }).waitFor();
  await page.getByText('Server connected', { exact: true }).waitFor();
  await mkdir('.data/screenshots', { recursive: true });
  await page.screenshot({ path: '.data/screenshots/dashboard.png', fullPage: true });
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('heading', { name: 'SETTINGS', exact: true }).waitFor();
  await page.getByText('@Adventnl', { exact: true }).waitFor();
  await page.screenshot({ path: '.data/screenshots/settings.png', fullPage: true });
  await page.getByRole('button', { name: 'New task', exact: true }).click();
  await page.getByPlaceholder('What are we building?').waitFor();
  await page
    .getByRole('button', { name: 'Adventnl/codex-cloud Public', exact: false })
    .first()
    .waitFor();
  await page.getByLabel('Search repositories').fill('codex-cloud');
  await page
    .getByRole('button', { name: 'Adventnl/codex-cloud Public', exact: false })
    .first()
    .click();
  await page.getByLabel('Base branch for Adventnl/codex-cloud').waitFor();
  await page.screenshot({ path: '.data/screenshots/new-task.png', fullPage: true });
  const taskId = (await readFile('.data/smoke-task-id.txt', 'utf8')).trim();
  await page.getByRole('button', { name: 'Dashboard', exact: true }).click();
  await page
    .getByRole('button')
    .filter({ hasText: 'Codex Home integration verification' })
    .first()
    .click();
  await page.getByRole('button', { name: 'Changes', exact: false }).click();
  await page.screenshot({ path: '.data/screenshots/task.png', fullPage: true });
  await page.getByRole('button', { name: 'Collapse details' }).click();
  await page.getByRole('button', { name: 'Expand details' }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Dashboard', exact: true }).click();
  await page.screenshot({ path: '.data/screenshots/mobile.png', fullPage: true });
  const overflowing = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  if (overflowing) failures.push('Mobile viewport has horizontal page overflow');
  if (failures.length) throw new Error(failures.join('\n'));
  console.log(
    JSON.stringify({
      browser: 'Chromium',
      pages: [
        'dashboard',
        'settings',
        'new task + real repository selection',
        'task changes + collapsible details',
        '390px mobile dashboard',
      ],
      pageErrors: failures,
      taskId,
    }),
  );
} finally {
  await browser.close();
}
