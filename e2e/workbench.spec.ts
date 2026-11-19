import { test, expect } from '@playwright/test';

test.describe('Turwin Labs — UBK Protocol Workbench E2E', () => {
  test('navigates Overview, Research, Open Source, and runs feasible + impossible benchmarks with zero errors or external calls', async ({
    page,
    baseURL,
  }) => {
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    const externalOrigins: string[] = [];
    const unexpectedFailures: string[] = [];

    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => pageErrors.push(String(err)));
    page.on('request', (req) => {
      const url = req.url();
      if (baseURL && !url.startsWith(baseURL) && !url.startsWith('data:') && !url.startsWith('blob:')) {
        externalOrigins.push(url);
      }
    });
    page.on('response', (res) => {
      if (res.status() >= 400) {
        unexpectedFailures.push(`${res.status()} ${res.url()}`);
      }
    });

    // 1. Overview page
    await page.goto('/');
    await expect(page.getByTestId('overview-health')).toContainText('ONLINE');
    await expect(page.locator('h1')).toContainText('Formal bounds for generative reasoning');

    // 2. Research page
    await page.getByTestId('nav-research').click();
    await expect(page.getByTestId('research-page')).toBeVisible();
    await expect(page.getByTestId('research-page')).toContainText('Universal Bounds Kernel');

    // 3. Open Source page
    await page.getByTestId('nav-open-source').click();
    await expect(page.getByTestId('open-source-page')).toBeVisible();
    await expect(page.getByTestId('github-primary-link')).toHaveAttribute(
      'href',
      'https://github.com/realsuperheavy/ubk-protocol-workbench'
    );

    // 4. Interactive Workbench — Feasible Z3 SAT benchmark
    await page.getByTestId('nav-workbench').click();
    await expect(page.getByTestId('health-status')).toContainText('API: ONLINE');

    await page.getByTestId('benchmark-inplace-sort-sat').click();
    await page.getByTestId('run-button').click();
    await expect(page.getByTestId('result-panel')).toBeVisible();
    await expect(page.getByTestId('verdict-badge')).toHaveText('PASS');
    await expect(page.getByTestId('certificate-type')).toContainText('Unique-Correct');
    await expect(page.getByTestId('smt-proof')).toContainText('[Z3] SAT');

    // 5. Interactive Workbench — Impossible O(n) comparison sort benchmark
    await page.getByTestId('benchmark-linear-comparison-sort-unsat').click();
    await page.getByTestId('run-button').click();
    await expect(page.getByTestId('verdict-badge')).toHaveText('IMPOSSIBLE');
    await expect(page.getByTestId('imp-cert-card').first()).toBeVisible();

    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
    expect(externalOrigins).toEqual([]);
    expect(unexpectedFailures).toEqual([]);
  });

  test('fails loudly in Live BYOK mode when no API key is configured (no silent mock fallback)', async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(String(err)));

    await page.goto('/workbench');
    await expect(page.getByTestId('health-status')).toContainText('API: ONLINE');

    await page.getByTestId('mode-live').click();
    await page.getByTestId('run-button').click();

    await expect(page.getByTestId('error-banner')).toBeVisible();
    await expect(page.getByTestId('error-banner')).toContainText('MISSING_API_KEY');
    await expect(page.getByTestId('result-panel')).toHaveCount(0);
    expect(pageErrors).toEqual([]);
  });
});
