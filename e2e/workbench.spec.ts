import { test, expect } from '@playwright/test';

test.describe('Turwin Labs — UBK Protocol Workbench E2E', () => {
  test('verifies counterfactual Carnot pair, live numeric Nyquist flip, honest abstention, 2026 Research citations, and Z3 DAG proof', async ({
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

    // 1. Overview page (dark mode default + counterfactual Carnot SAT -> UNSAT -> UNVERIFIED abstention)
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.getByTestId('overview-health')).toContainText('ONLINE');
    await expect(page.locator('h1')).toContainText('Formal bounds for generative reasoning');
    await expect(page.getByTestId('hero-console')).toContainText('Bounded-Verified');
    await expect(page.getByTestId('hero-console')).toContainText('FORMAL_SMT');

    await page.getByTestId('hero-case-carnot-infeasible-unsat').click();
    await expect(page.getByTestId('hero-console')).toContainText('IMPOSSIBLE');
    await expect(page.getByTestId('hero-console')).toContainText('Refuted');

    await page.getByTestId('hero-case-unformalized-prose-abstain').click();
    await expect(page.getByTestId('hero-console')).toContainText('UNVERIFIED');
    await expect(page.getByTestId('hero-console')).toContainText('Unverified-Within-Bounds');

    // Live numeric perturbation test right in Overview console: Nyquist 30 kHz -> 48 kHz flips IMPOSSIBLE -> PASS
    await page.getByTestId('hero-case-nyquist-undersampling-unsat').click();
    await expect(page.getByTestId('hero-console')).toContainText('IMPOSSIBLE');
    await page.locator('.console-input').fill(
      'Reconstruct a bandlimited 20 kHz analog signal without aliasing using a 48 kHz uniform sampling rate'
    );
    await page.getByTestId('hero-verify-btn').click();
    await expect(page.getByTestId('hero-console')).toContainText('PASS');
    await expect(page.getByTestId('hero-console')).toContainText('Bounded-Verified');

    await page.getByTestId('stage-03').click();
    await expect(page.locator('.dot-canvas')).toContainText('BOUNDED CERTIFICATE OUTPUT');

    // 2. Research page (2026 SOTA citations + explicit Threat Model)
    await page.getByTestId('nav-research').click();
    await expect(page.getByTestId('research-page')).toBeVisible();
    await expect(page.getByTestId('research-page')).toContainText('SOVER');
    await expect(page.getByTestId('research-page')).toContainText('SHADOWBENCH');
    await expect(page.getByTestId('research-page')).toContainText('NSVIF');

    // 3. Open Source page
    await page.getByTestId('nav-open-source').click();
    await expect(page.getByTestId('open-source-page')).toBeVisible();
    await expect(page.getByTestId('github-primary-link')).toHaveAttribute(
      'href',
      'https://github.com/TurwinAI/ubk-protocol-workbench'
    );

    // 4. Interactive Workbench — Carnot 40% SAT + Execution Graph Z3 DAG Proof
    await page.getByTestId('nav-workbench').click();
    await expect(page.getByTestId('health-status')).toContainText('API: ONLINE');

    await page.getByTestId('benchmark-carnot-feasible-sat').click();
    await page.getByTestId('run-button').click();
    await expect(page.getByTestId('result-panel')).toBeVisible();
    await expect(page.getByTestId('verdict-badge')).toHaveText('PASS');
    await expect(page.getByTestId('certificate-type')).toContainText('Bounded-Verified');
    await expect(page.getByTestId('smt-proof')).toContainText('[Z3] SAT');

    await page.getByRole('button', { name: /Execution Graph/i }).click();
    await expect(page.getByTestId('dag-proof-card')).toContainText('Z3-SAT');

    // 5. Interactive Workbench — Carnot 65% UNSAT
    await page.getByTestId('benchmark-carnot-infeasible-unsat').click();
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
