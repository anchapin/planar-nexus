/**
 * Lazy card-script loading (#1814): the generated index ships in its own
 * chunk and is installed by loadCardScripts().
 */
import {
  cardScriptsLoaded,
  getCardScript,
  listScriptedCardNames,
  loadCardScripts,
  registerCardScripts,
  resetCardScriptsForTests,
} from "../registry";
import { RAW_CARD_SCRIPTS } from "../cards/index.generated";

afterEach(() => {
  resetCardScriptsForTests();
  registerCardScripts(RAW_CARD_SCRIPTS);
});

describe("card-script registry loading", () => {
  it("reads every card as unscripted before the index loads", () => {
    resetCardScriptsForTests();
    expect(cardScriptsLoaded()).toBe(false);
    expect(getCardScript("Lightning Strike")).toBeUndefined();
    expect(listScriptedCardNames()).toEqual([]);
  });

  it("installs the index once and shares the load", async () => {
    resetCardScriptsForTests();
    const a = loadCardScripts();
    const b = loadCardScripts();
    await Promise.all([a, b]);
    expect(cardScriptsLoaded()).toBe(true);
    expect(getCardScript("lightning strike")?.name).toBe("Lightning Strike");
    expect(listScriptedCardNames()).toHaveLength(RAW_CARD_SCRIPTS.length);
  });

  it("resolves at once when already loaded", async () => {
    await expect(loadCardScripts()).resolves.toBeUndefined();
    expect(cardScriptsLoaded()).toBe(true);
  });
});
