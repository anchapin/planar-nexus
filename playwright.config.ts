import { defineConfig } from '@playwright/test';

/**
 * Playwright Configuration for Planar Nexus E2E Tests
 * 
 * This configuration sets up E2E testing for the Planar Nexus application.
 * Tests run against a local dev server on port 9002.
 */
export default defineConfig({
  // Directory containing E2E tests
  testDir: './e2e',
  
  // Timeout for individual tests (30 seconds)
  timeout: 30000,
  
  // Timeout for expectations (5 seconds)
  expect: {
    timeout: 5000,
  },
  
  // Run tests in parallel
  fullyParallel: true,
  
  // Number of retries for flaky tests
  retries: process.env.CI ? 2 : 0,
  
  // Number of workers (parallel processes)
  workers: process.env.CI ? 1 : undefined,
  
  // Fail the build on CI if you accidentally left test.only in the source code
  forbidOnly: !!process.env.CI,
  
  // Reporter configuration
  reporter: [
    ['html', { outputFolder: 'playwright-report' }],
    ['list'],
    ...(process.env.CI ? [['github'] as const] : []),
  ],
  
  // Shared settings for all the projects below
  use: {
    // Base URL for all tests
    baseURL: process.env.BASE_URL || 'http://localhost:9002',
    
    // Collect trace when retrying the failed test
    trace: 'on-first-retry',
    
    // Capture screenshot on failure
    screenshot: 'only-on-failure',
    
    // Record video on failure
    video: 'retain-on-failure',
    
    // Browser context options
    viewport: { width: 1280, height: 720 },
  },
  
  // Configure projects for major browsers
  // Only run Chromium in CI/local environments since other browsers may not be installed
  projects: [
    {
      name: 'chromium',
      use: { 
        // Test against Chromium
        channel: 'chromium',
      },
    },
  ],
  
  // Run local dev server before starting tests
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:9002',
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
});
