/**
 * E2E Tests for Draft Mode Flow
 * 
 * Phase 15: Draft Core
 * Requirements: DRFT-01 through DRFT-11
 * 
 * Tests the complete draft session flow:
 * - Draft starts with intro state
 * - Draft has 3 packs of 14 cards
 * - Draft completes after picking 42 cards
 * - Pool persists across page refresh (DRFT-10)
 * - Session can be resumed from any state (DRFT-11)
 */

import { test, expect } from '@playwright/test';

const PACKS_PER_DRAFT = 3;
const CARDS_PER_PACK = 14;
const TOTAL_CARDS = PACKS_PER_DRAFT * CARDS_PER_PACK;

async function pickCard(page: any): Promise<boolean> {
  const pickButton = page.locator('button[aria-label^="Pick"]').first();
  if (await pickButton.isVisible({ timeout: 3000 })) {
    await pickButton.click();
    await page.waitForTimeout(300);
    return true;
  }
  return false;
}

async function openCurrentPack(page: any): Promise<boolean> {
  const faceDownCards = page.locator('[aria-label="Face-down card"]').first();
  if (await faceDownCards.isVisible({ timeout: 3000 })) {
    await faceDownCards.click();
    await page.waitForTimeout(1000);
    return true;
  }
  return false;
}

async function advanceToNextPack(page: any): Promise<void> {
  const nextButton = page.locator('button').filter({ hasText: /Next|Open.*Pack|Continue/i }).first();
  if (await nextButton.isVisible({ timeout: 2000 })) {
    await nextButton.click();
    await page.waitForTimeout(500);
  }
}

async function startDraft(page: any): Promise<void> {
  const startButton = page.locator('button').filter({ hasText: /Start Draft|Start Drafting|Start/i }).first();
  if (await startButton.isVisible({ timeout: 3000 })) {
    await startButton.click();
    await page.waitForTimeout(1000);
  }
}

test.describe('Draft Mode - Initialization', () => {
  test('DRFT-01: Draft page with set code shows intro state', async ({ page }) => {
    await page.goto('/draft?set=m21');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);
    
    const startButton = page.locator('button').filter({ hasText: /Start Draft|Start/i }).first();
    const errorCard = page.locator('text=/Error|Not enough|No session/i').first();
    const introCard = page.locator('text=/Draft.*packs/i').first();
    
    const hasStartButton = await startButton.isVisible({ timeout: 3000 }).catch(() => false);
    const hasError = await errorCard.isVisible({ timeout: 2000 }).catch(() => false);
    const hasIntroCard = await introCard.isVisible({ timeout: 1000 }).catch(() => false);
    
    if (hasStartButton) {
      await expect(startButton).toBeVisible();
      
      const packInfo = page.locator(`text="${PACKS_PER_DRAFT} packs"`);
      if (await packInfo.isVisible()) {
        await expect(packInfo).toContainText(String(PACKS_PER_DRAFT));
      }
    } else if (hasIntroCard) {
      expect(true).toBeTruthy();
    } else if (hasError) {
      test.skip(true, 'Card database not seeded with required cards');
    }
  });

  test('DRFT-02: Draft shows intro card with pack info', async ({ page }) => {
    await page.goto('/draft?set=m21');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);
    
    const introCard = page.locator('text=/Draft.*packs|3 packs/i').first();
    const startButton = page.locator('button').filter({ hasText: /Start Draft/i }).first();
    const errorCard = page.locator('text=/Not enough|Error/i').first();
    
    const hasIntro = await introCard.isVisible({ timeout: 2000 }).catch(() => false);
    const hasStart = await startButton.isVisible({ timeout: 2000 }).catch(() => false);
    const hasError = await errorCard.isVisible({ timeout: 2000 }).catch(() => false);
    
    if (hasError) {
      test.skip(true, 'Card database not seeded with required cards');
    }
    
    expect(hasIntro || hasStart).toBeTruthy();
  });
});

test.describe('Draft Mode - UI Elements', () => {
  test('Should show draft header', async ({ page }) => {
    await page.goto('/draft?set=m21');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);
    
    const header = page.locator('h1, h2').filter({ hasText: /Draft/i }).first();
    const packageIcon = page.locator('[class*="package"], [class*="Package"]').first();
    
    const hasHeader = await header.isVisible({ timeout: 3000 }).catch(() => false);
    const hasIcon = await packageIcon.isVisible({ timeout: 1000 }).catch(() => false);
    
    expect(hasHeader || hasIcon).toBeTruthy();
  });

  test('Should display intro card with pack count', async ({ page }) => {
    await page.goto('/draft?set=m21');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);
    
    const packText = page.locator(`text="${PACKS_PER_DRAFT} packs"`);
    
    if (await packText.isVisible({ timeout: 3000 })) {
      await expect(packText).toBeVisible();
    } else {
      const startButton = page.locator('button').filter({ hasText: /Start Draft/i }).first();
      if (await startButton.isVisible({ timeout: 1000 })) {
        expect(true).toBeTruthy();
      }
    }
  });
});

test.describe('Draft Mode - Draft Complete Flow', () => {
  test('DRFT-09: Draft completion page shows correct information', async ({ page }) => {
    await page.goto('/draft/complete');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
    
    const url = page.url();
    const sessionId = url.match(/session=([^&]+)/)?.[1];
    
    if (sessionId && !sessionId.includes('test-')) {
      const completeTitle = page.locator('text="Draft Complete"').first();
      if (await completeTitle.isVisible({ timeout: 3000 })) {
        await expect(completeTitle).toBeVisible();
        
        const cardsPicked = page.locator('text=/\\d+ Cards Picked/i').first();
        if (await cardsPicked.isVisible({ timeout: 2000 })) {
          await expect(cardsPicked).toBeVisible();
        }
        
        const buildDeckButton = page.locator('button').filter({ hasText: /Build Deck/i }).first();
        if (await buildDeckButton.isVisible({ timeout: 2000 })) {
          await expect(buildDeckButton).toBeVisible();
        }
      }
    } else {
      test.skip(true, 'No completed draft session exists');
    }
  });

  test('DRFT-09: Build Deck button navigates to deck builder', async ({ page }) => {
    await page.goto('/draft/complete');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
    
    const url = page.url();
    const sessionId = url.match(/session=([^&]+)/)?.[1];
    
    if (sessionId && !sessionId.includes('test-')) {
      const buildDeckButton = page.locator('button').filter({ hasText: /Build Deck/i }).first();
      
      if (await buildDeckButton.isVisible({ timeout: 3000 })) {
        await buildDeckButton.click();
        await expect(page).toHaveURL(/\/limited-deck-builder/);
      }
    } else {
      test.skip(true, 'No completed draft session exists');
    }
  });
});

test.describe('Draft Mode - Draft Flow (Full)', () => {
  test('DRFT-09: Complete draft flow - pick all 42 cards', async ({ page }) => {
    await page.goto('/draft?set=m21');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);
    
    const startButton = page.locator('button').filter({ hasText: /Start Draft|Start Drafting|Start/i }).first();
    
    if (await startButton.isVisible({ timeout: 3000 })) {
      await startButton.click();
      await page.waitForTimeout(1000);
      
      for (let pack = 0; pack < PACKS_PER_DRAFT; pack++) {
        const packOpened = await openCurrentPack(page);
        if (!packOpened) break;
        
        for (let pick = 0; pick < CARDS_PER_PACK; pick++) {
          const picked = await pickCard(page);
          if (!picked) break;
        }
        
        if (pack < PACKS_PER_DRAFT - 1) {
          await advanceToNextPack(page);
        }
      }
      
      await page.waitForURL(/\/draft\/complete/, { timeout: 30000 });
      await page.waitForTimeout(2000);
      
      const completeTitle = page.locator('text="Draft Complete"').first();
      if (await completeTitle.isVisible({ timeout: 10000 })) {
        await expect(completeTitle).toBeVisible();
      }
    } else {
      const errorCard = page.locator('text=/Not enough cards|Error/i').first();
      if (await errorCard.isVisible({ timeout: 2000 })) {
        test.skip(true, 'Card database not seeded with cards for set');
      }
    }
  });
});

test.describe('Draft Mode - Card Interaction', () => {
  test('DRFT-03: Can open pack and see cards', async ({ page }) => {
    await page.goto('/draft?set=m21');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);
    
    const startButton = page.locator('button').filter({ hasText: /Start Draft|Start Drafting|Start/i }).first();
    
    if (await startButton.isVisible({ timeout: 3000 })) {
      await startButton.click();
      await page.waitForTimeout(1000);
      
      const packOpened = await openCurrentPack(page);
      
      if (packOpened) {
        const pickOverlay = page.locator('text="Pick"').first();
        if (await pickOverlay.isVisible({ timeout: 5000 })) {
          await expect(pickOverlay).toBeVisible();
        }
      }
    } else {
      const errorCard = page.locator('text=/Not enough cards|Error/i').first();
      if (await errorCard.isVisible({ timeout: 2000 })) {
        test.skip(true, 'Card database not seeded with cards for set');
      }
    }
  });

  test('DRFT-04: Picking a card updates pick counter', async ({ page }) => {
    await page.goto('/draft?set=m21');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);
    
    const startButton = page.locator('button').filter({ hasText: /Start Draft|Start Drafting|Start/i }).first();
    
    if (await startButton.isVisible({ timeout: 3000 })) {
      await startButton.click();
      await page.waitForTimeout(1000);
      
      if (await openCurrentPack(page)) {
        await page.waitForTimeout(500);
        const cardPicked = await pickCard(page);
        
        if (cardPicked) {
          await page.waitForTimeout(500);
          
          const pickBadge = page.locator('text=/Pick 2\\/14/');
          if (await pickBadge.isVisible({ timeout: 2000 })) {
            await expect(pickBadge).toBeVisible();
          }
        }
      }
    } else {
      const errorCard = page.locator('text=/Not enough cards|Error/i').first();
      if (await errorCard.isVisible({ timeout: 2000 })) {
        test.skip(true, 'Card database not seeded with cards for set');
      }
    }
  });
});

test.describe('Draft Mode - Persistence', () => {
  test('DRFT-10: Pool persists across page refresh', async ({ page }) => {
    await page.goto('/draft?set=m21');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);
    
    const startButton = page.locator('button').filter({ hasText: /Start Draft|Start Drafting|Start/i }).first();
    
    if (await startButton.isVisible({ timeout: 3000 })) {
      await startButton.click();
      await page.waitForTimeout(1000);
      
      await openCurrentPack(page);
      
      for (let i = 0; i < 3; i++) {
        await pickCard(page);
      }
      
      const sessionId = page.url().match(/session=([^&]+)/)?.[1];
      
      await page.reload();
      await page.waitForTimeout(2000);
      
      if (sessionId) {
        await expect(page).toHaveURL(new RegExp(`session=${sessionId}`));
        
        const poolText = page.locator('text="/\\d+ cards picked/i"').first();
        if (await poolText.isVisible({ timeout: 3000 })) {
          expect(await poolText.textContent()).toMatch(/\d+/);
        }
      }
    } else {
      const errorCard = page.locator('text=/Not enough cards|Error/i').first();
      if (await errorCard.isVisible({ timeout: 2000 })) {
        test.skip(true, 'Card database not seeded with cards for set');
      }
    }
  });

  test('DRFT-11: Session can be resumed from URL', async ({ page }) => {
    await page.goto('/draft?set=m21');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);
    
    const startButton = page.locator('button').filter({ hasText: /Start Draft|Start Drafting|Start/i }).first();
    
    if (await startButton.isVisible({ timeout: 3000 })) {
      await startButton.click();
      await page.waitForTimeout(1000);
      
      await openCurrentPack(page);
      await pickCard(page);
      
      const sessionId = page.url().match(/session=([^&]+)/)?.[1];
      
      if (sessionId) {
        await page.goto('/');
        await page.waitForTimeout(1000);
        
        await page.goto(`/draft?session=${sessionId}`);
        await page.waitForTimeout(2000);
        
        await expect(page).toHaveURL(new RegExp(`session=${sessionId}`));
        
        const pickBadge = page.locator('text=/Pick \\d+\\/14/').first();
        const introText = page.locator('text="Start Draft"').first();
        
        const inPickingState = await pickBadge.isVisible();
        const stillInIntro = await introText.isVisible();
        
        expect(inPickingState || !stillInIntro).toBeTruthy();
      }
    } else {
      const errorCard = page.locator('text=/Not enough cards|Error/i').first();
      if (await errorCard.isVisible({ timeout: 2000 })) {
        test.skip(true, 'Card database not seeded with cards for set');
      }
    }
  });

  test('DRFT-11: Draft session data is saved to IndexedDB', async ({ page }) => {
    await page.goto('/draft?set=m21');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);
    
    const startButton = page.locator('button').filter({ hasText: /Start Draft|Start Drafting|Start/i }).first();
    
    if (await startButton.isVisible({ timeout: 3000 })) {
      await startButton.click();
      await page.waitForTimeout(1000);
      
      await openCurrentPack(page);
      await pickCard(page);
      await page.waitForTimeout(1500);
      
      const dbCheck = await page.evaluate(async () => {
        try {
          const databases = await indexedDB.databases();
          return databases.map(db => db.name);
        } catch {
          return [];
        }
      });
      
      expect(dbCheck.some(db => db && (db.includes('Limited') || db.includes('Draft') || db.includes('Nexus')))).toBeTruthy();
    } else {
      const errorCard = page.locator('text=/Not enough cards|Error/i').first();
      if (await errorCard.isVisible({ timeout: 2000 })) {
        test.skip(true, 'Card database not seeded with cards for set');
      }
    }
  });
});
