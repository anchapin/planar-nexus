import { test, expect, seedCardDatabase, loadDeck } from "./test-utils";

test.describe("AI Deck Assistant", () => {
  test.beforeEach(async ({ page }) => {
    // Register both init scripts BEFORE navigation (issue #1856).
    // loadDeck wires the production `decks` IndexedDB store +
    // localStorage fallbacks so the deck-builder's saved-decks
    // sidebar renders the test commander deck; seedCardDatabase
    // populates the local card lookup DB that the AI assistant and
    // deck-builder search rely on. Order doesn't matter — both are
    // addInitScript hooks that run before page scripts.
    await loadDeck(page);
    await seedCardDatabase(page);

    // Navigate to deck builder. Use `domcontentloaded` rather than
    // `networkidle`: the dev server's HMR websocket + the deck-builder's
    // background sync keep the network busy indefinitely, so `networkidle`
    // times out at 30s on CI runners and the beforeEach hook hangs.
    await page.goto("/deck-builder");
    await page.waitForLoadState("domcontentloaded");
  });

  test("should display initial state of AI Assistant", async ({ page }) => {
    // AIDeckAssistant is dynamically imported (ssr: false) for code splitting,
    // so allow extra time for the chunk to load and render on CI runners.
    const assistant = page.locator("text=AI Assistant");
    await expect(assistant).toBeVisible({ timeout: 15000 });

    // Initial state surfaces "Smart suggestions based on your current deck."
    // and an "Enable AI Suggestions" CTA. The "Add cards to your deck"
    // prompt only renders AFTER the user enables suggestions, so we
    // assert on the always-rendered CTA instead.
    const enableButton = page.locator("text=Enable AI Suggestions");
    await expect(enableButton).toBeVisible({ timeout: 10000 });
  });

  // Skipped: Requires AI service (Gemini) that may not be available in CI
  test.skip("should provide synergistic suggestions after adding cards", async ({
    page,
  }) => {
    // 1. Search for a card
    const searchInput = page.getByTestId("card-search-input");
    await searchInput.fill("Sol Ring");

    // 2. Add Sol Ring to the deck
    const solRingResult = page.getByTestId("card-result-sol-ring");
    await expect(solRingResult).toBeVisible({ timeout: 10000 });
    await solRingResult.click();

    // 3. Search and add another card to trigger more synergy
    await searchInput.clear();
    await searchInput.fill("Arcane Signet");
    const arcaneSignetResult = page.getByTestId("card-result-arcane-signet");
    await expect(arcaneSignetResult).toBeVisible({ timeout: 10000 });
    await arcaneSignetResult.click();

    // 4. Verify AI Assistant updates with suggestions
    // Note: Synergy calculation is debounced (500ms) and uses a Web Worker
    const suggestionCards = page.locator("h4.font-bold.text-xs");
    await expect(suggestionCards.first()).toBeVisible({ timeout: 15000 });

    const suggestionCount = await suggestionCards.count();
    expect(suggestionCount).toBeGreaterThan(0);
  });

  // Skipped: Requires AI service that may not be available in CI
  test.skip("should provide a streamed AI explanation", async ({ page }) => {
    // 1. Add a card to get suggestions
    const searchInput = page.getByTestId("card-search-input");
    await searchInput.fill("Sol Ring");
    const solRingResult = page.getByTestId("card-result-sol-ring");
    await expect(solRingResult).toBeVisible({ timeout: 10000 });
    await solRingResult.click();

    // 2. Wait for suggestions to appear
    const whyButton = page.locator('button:has-text("Why this card?")').first();
    await expect(whyButton).toBeVisible({ timeout: 15000 });

    // 3. Click "Why this card?"
    await whyButton.click();

    // 4. Check for loading state or streamed content
    // The component shows "Analyzing synergy..." while loading
    const explanationArea = page.locator("text=Analyzing synergy...");
    // It might be too fast to catch "Analyzing synergy...", so we check for the text content
    // We expect a streamed response eventually.

    // Check for the explanation text (it's inside an italic p tag)
    const explanationText = page.locator("p.leading-relaxed");
    await expect(explanationText).toBeVisible({ timeout: 20000 });
    const text = await explanationText.innerText();
    expect(text.length).toBeGreaterThan(0);
  });

  // Skipped: Requires AI service that may not be available in CI
  test.skip("should show synergy badges on card search results", async ({
    page,
  }) => {
    // 1. Add a card to establish a synergy context
    const searchInput = page.getByTestId("card-search-input");
    await searchInput.fill("Sol Ring");
    const solRingResult = page.getByTestId("card-result-sol-ring");
    await expect(solRingResult).toBeVisible({ timeout: 10000 });
    await solRingResult.click();

    // 2. Search for cards that should have synergy (e.g., more mana rocks)
    await searchInput.clear();
    await searchInput.fill("Signet"); // Should find various signets

    // 3. Check for synergy badges
    const synergyBadge = page.getByTestId("synergy-badge").first();
    await expect(synergyBadge).toBeVisible({ timeout: 15000 });

    const badgeText = await synergyBadge.innerText();
    expect(badgeText).toMatch(/\d+%/);
  });
});
