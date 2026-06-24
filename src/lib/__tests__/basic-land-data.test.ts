import {
  BASIC_LAND_NAMES,
  BASIC_LAND_COLORS,
  BASIC_LAND_MANA_ABILITIES,
  BASIC_LAND_MANA_ABILITY_BY_COLOR,
  getBasicLandColor,
  getBasicLandManaAbility,
  getBasicLandManaAbilityByColor,
} from "@/lib/basic-land-data";
import * as fs from "fs";
import * as path from "path";

describe("basic-land-data", () => {
  describe("BASIC_LAND_MANA_ABILITIES", () => {
    it("exports the 5 basic lands with their canonical mana-ability strings", () => {
      expect(BASIC_LAND_MANA_ABILITIES).toEqual({
        Plains: "{T}: Add {W}",
        Island: "{T}: Add {U}",
        Swamp: "{T}: Add {B}",
        Mountain: "{T}: Add {R}",
        Forest: "{T}: Add {G}",
      });
    });

    it("provides one ability per basic land name", () => {
      expect(Object.keys(BASIC_LAND_MANA_ABILITIES).sort()).toEqual(
        [...BASIC_LAND_NAMES].sort(),
      );
    });

    it("each ability taps for its land's own color", () => {
      for (const name of BASIC_LAND_NAMES) {
        const color = BASIC_LAND_COLORS[name];
        expect(BASIC_LAND_MANA_ABILITIES[name]).toBe(`{T}: Add {${color}}`);
      }
    });
  });

  describe("BASIC_LAND_COLORS", () => {
    it("maps each basic land to its WUBRG color identity", () => {
      expect(BASIC_LAND_COLORS).toEqual({
        Plains: "W",
        Island: "U",
        Swamp: "B",
        Mountain: "R",
        Forest: "G",
      });
    });
  });

  describe("BASIC_LAND_MANA_ABILITY_BY_COLOR", () => {
    it("maps each color code to the matching mana-ability string", () => {
      expect(BASIC_LAND_MANA_ABILITY_BY_COLOR).toEqual({
        W: "{T}: Add {W}",
        U: "{T}: Add {U}",
        B: "{T}: Add {B}",
        R: "{T}: Add {R}",
        G: "{T}: Add {G}",
      });
    });
  });

  describe("lookup helpers", () => {
    it("resolve color and ability by land name", () => {
      expect(getBasicLandColor("Forest")).toBe("G");
      expect(getBasicLandManaAbility("Forest")).toBe("{T}: Add {G}");
    });

    it("resolve ability by color code", () => {
      expect(getBasicLandManaAbilityByColor("W")).toBe("{T}: Add {W}");
    });

    it("return an empty string for unknown inputs", () => {
      expect(getBasicLandColor("Urza's Tower")).toBe("");
      expect(getBasicLandManaAbility("Urza's Tower")).toBe("");
      expect(getBasicLandManaAbilityByColor("C")).toBe("");
    });
  });

  // Regression guard for issue #925: the seed pages must not reintroduce
  // hardcoded basic-land mana-ability literals — they should source them from
  // the shared module instead.
  describe("seed pages do not hardcode duplicate mana-ability literals", () => {
    const seedPages = [
      "src/app/(app)/game/[id]/page.tsx",
      "src/app/(app)/spectator/page.tsx",
    ];
    const repoRoot = process.cwd();
    const bannedPatterns = [
      /\{T\}:\s*Add\s*\{W\}/,
      /\{T\}:\s*Add\s*\{U\}/,
      /\{T\}:\s*Add\s*\{B\}/,
      /\{T\}:\s*Add\s*\{R\}/,
      /\{T\}:\s*Add\s*\{G\}/,
      /`\{T\}:\s*Add\s*\$\{/, // template-literal variant `{T}: Add {${color}}`
    ];

    for (const relPath of seedPages) {
      it(`${relPath} has no hardcoded basic-land mana literals`, () => {
        const absPath = path.resolve(repoRoot, relPath);
        const source = fs.readFileSync(absPath, "utf8");
        const hits = bannedPatterns.filter((re) => re.test(source));
        expect(hits).toEqual([]);
      });
    }
  });
});
