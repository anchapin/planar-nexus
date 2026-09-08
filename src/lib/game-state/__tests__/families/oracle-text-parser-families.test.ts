/**
 * Family-surface smoke tests (issue #1725).
 *
 * oracle-text-parser/ was decomposed into per-family modules. These tests pin each
 * family module's exported surface AND that the oracle-text-parser.ts re-export shim
 * exposes the exact same runtime names, so any move/rename that would
 * break an importer fails at the family boundary. Behavioral coverage
 * lives in the existing per-family suites (cycling, blitz, foretell,
 * monarchy, …).
 */

import * as fam0 from '../../oracle-text-parser/abilities';
import type * as famT0 from '../../oracle-text-parser/abilities';
import * as fam1 from '../../oracle-text-parser/alternative-costs';
import type * as famT1 from '../../oracle-text-parser/alternative-costs';
import * as fam2 from '../../oracle-text-parser/casting-keywords';
import type * as famT2 from '../../oracle-text-parser/casting-keywords';
import * as fam3 from '../../oracle-text-parser/core';
import type * as famT3 from '../../oracle-text-parser/core';
import * as fam4 from '../../oracle-text-parser/cycling';
import type * as famT4 from '../../oracle-text-parser/cycling';
import * as fam5 from '../../oracle-text-parser/escape';
import type * as famT5 from '../../oracle-text-parser/escape';
import * as fam6 from '../../oracle-text-parser/keywords';
import type * as famT6 from '../../oracle-text-parser/keywords';
import * as fam7 from '../../oracle-text-parser/mana-cost';
import type * as famT7 from '../../oracle-text-parser/mana-cost';
import * as fam8 from '../../oracle-text-parser/modes';
import type * as famT8 from '../../oracle-text-parser/modes';
import * as fam9 from '../../oracle-text-parser/tribute-renown';
import type * as famT9 from '../../oracle-text-parser/tribute-renown';
import * as shim from '../../oracle-text-parser';

describe('oracle-text-parser/abilities family surface', () => {
  it('exports every runtime member of the original module surface', () => {
    expect(typeof fam0.parseActivatedAbilities).not.toBe('undefined');
    expect(typeof fam0.parseTriggeredAbilities).not.toBe('undefined');
    expect(typeof fam0.parseStaticAbilities).not.toBe('undefined');
    expect(typeof fam0.canGoOnStack).not.toBe('undefined');
  });

  it('shim re-exports the same runtime names', () => {
    expect(typeof shim.parseActivatedAbilities).not.toBe('undefined');
    expect(typeof shim.parseTriggeredAbilities).not.toBe('undefined');
    expect(typeof shim.parseStaticAbilities).not.toBe('undefined');
    expect(typeof shim.canGoOnStack).not.toBe('undefined');
  });
  it('type surface compiles against the family module', () => {
    type _Surface = typeof famT0;
    expect(true).toBe(true);
  });
});

describe('oracle-text-parser/alternative-costs family surface', () => {
  it('exports every runtime member of the original module surface', () => {
    expect(typeof fam1.parseKicker).not.toBe('undefined');
    expect(typeof fam1.parsePrototype).not.toBe('undefined');
    expect(typeof fam1.AlternativeCostType).not.toBe('undefined');
    expect(typeof fam1.parseAlternativeCost).not.toBe('undefined');
    expect(typeof fam1.parseBuyback).not.toBe('undefined');
    expect(typeof fam1.parseFlashback).not.toBe('undefined');
    expect(typeof fam1.parseBestow).not.toBe('undefined');
    expect(typeof fam1.parseMutate).not.toBe('undefined');
    expect(typeof fam1.parseBlitz).not.toBe('undefined');
    expect(typeof fam1.parseForetell).not.toBe('undefined');
    expect(typeof fam1.parseSpectacle).not.toBe('undefined');
  });

  it('shim re-exports the same runtime names', () => {
    expect(typeof shim.parseKicker).not.toBe('undefined');
    expect(typeof shim.parsePrototype).not.toBe('undefined');
    expect(typeof shim.AlternativeCostType).not.toBe('undefined');
    expect(typeof shim.parseAlternativeCost).not.toBe('undefined');
    expect(typeof shim.parseBuyback).not.toBe('undefined');
    expect(typeof shim.parseFlashback).not.toBe('undefined');
    expect(typeof shim.parseBestow).not.toBe('undefined');
    expect(typeof shim.parseMutate).not.toBe('undefined');
    expect(typeof shim.parseBlitz).not.toBe('undefined');
    expect(typeof shim.parseForetell).not.toBe('undefined');
    expect(typeof shim.parseSpectacle).not.toBe('undefined');
  });
  it('type surface compiles against the family module', () => {
    type _Surface = typeof famT1;
    expect(true).toBe(true);
  });
});

describe('oracle-text-parser/casting-keywords family surface', () => {
  it('exports every runtime member of the original module surface', () => {
    expect(typeof fam2.parseSplitSecond).not.toBe('undefined');
    expect(typeof fam2.parseStorm).not.toBe('undefined');
    expect(typeof fam2.parseProwess).not.toBe('undefined');
    expect(typeof fam2.parseConvoke).not.toBe('undefined');
    expect(typeof fam2.parseDelve).not.toBe('undefined');
    expect(typeof fam2.parseAttraction).not.toBe('undefined');
  });

  it('shim re-exports the same runtime names', () => {
    expect(typeof shim.parseSplitSecond).not.toBe('undefined');
    expect(typeof shim.parseStorm).not.toBe('undefined');
    expect(typeof shim.parseProwess).not.toBe('undefined');
    expect(typeof shim.parseConvoke).not.toBe('undefined');
    expect(typeof shim.parseDelve).not.toBe('undefined');
    expect(typeof shim.parseAttraction).not.toBe('undefined');
  });
  it('type surface compiles against the family module', () => {
    type _Surface = typeof famT2;
    expect(true).toBe(true);
  });
});

describe('oracle-text-parser/core family surface', () => {
  it('exports every runtime member of the original module surface', () => {
    expect(typeof fam3.AbilityType).not.toBe('undefined');
    expect(typeof fam3.parseOracleText).not.toBe('undefined');
    expect(typeof fam3.getCardAbilities).not.toBe('undefined');
  });

  it('shim re-exports the same runtime names', () => {
    expect(typeof shim.AbilityType).not.toBe('undefined');
    expect(typeof shim.parseOracleText).not.toBe('undefined');
    expect(typeof shim.getCardAbilities).not.toBe('undefined');
  });
  it('type surface compiles against the family module', () => {
    type _Surface = typeof famT3;
    expect(true).toBe(true);
  });
});

describe('oracle-text-parser/cycling family surface', () => {
  it('exports every runtime member of the original module surface', () => {
    expect(typeof fam4.CyclingVariant).not.toBe('undefined');
    expect(typeof fam4.parseCycling).not.toBe('undefined');
  });

  it('shim re-exports the same runtime names', () => {
    expect(typeof shim.CyclingVariant).not.toBe('undefined');
    expect(typeof shim.parseCycling).not.toBe('undefined');
  });
  it('type surface compiles against the family module', () => {
    type _Surface = typeof famT4;
    expect(true).toBe(true);
  });
});

describe('oracle-text-parser/escape family surface', () => {
  it('exports every runtime member of the original module surface', () => {
    expect(typeof fam5.parseEscapeExileCount).not.toBe('undefined');
    expect(typeof fam5.parseEscape).not.toBe('undefined');
  });

  it('shim re-exports the same runtime names', () => {
    expect(typeof shim.parseEscapeExileCount).not.toBe('undefined');
    expect(typeof shim.parseEscape).not.toBe('undefined');
  });
  it('type surface compiles against the family module', () => {
    type _Surface = typeof famT5;
    expect(true).toBe(true);
  });
});

describe('oracle-text-parser/keywords family surface', () => {
  it('exports every runtime member of the original module surface', () => {
    expect(typeof fam6.extractKeywords).not.toBe('undefined');
  });

  it('shim re-exports the same runtime names', () => {
    expect(typeof shim.extractKeywords).not.toBe('undefined');
  });
  it('type surface compiles against the family module', () => {
    type _Surface = typeof famT6;
    expect(true).toBe(true);
  });
});

describe('oracle-text-parser/mana-cost family surface', () => {
  it('exports every runtime member of the original module surface', () => {
    expect(typeof fam7.parseManaCost).not.toBe('undefined');
    expect(typeof fam7.formatManaCost).not.toBe('undefined');
    expect(typeof fam7.manaCostsEqual).not.toBe('undefined');
    expect(typeof fam7.getManaValue).not.toBe('undefined');
    expect(typeof fam7.parseXCost).not.toBe('undefined');
  });

  it('shim re-exports the same runtime names', () => {
    expect(typeof shim.parseManaCost).not.toBe('undefined');
    expect(typeof shim.formatManaCost).not.toBe('undefined');
    expect(typeof shim.manaCostsEqual).not.toBe('undefined');
    expect(typeof shim.getManaValue).not.toBe('undefined');
    expect(typeof shim.parseXCost).not.toBe('undefined');
  });
  it('type surface compiles against the family module', () => {
    type _Surface = typeof famT7;
    expect(true).toBe(true);
  });
});

describe('oracle-text-parser/modes family surface', () => {
  it('exports every runtime member of the original module surface', () => {
    expect(typeof fam8.isModalSpell).not.toBe('undefined');
    expect(typeof fam8.isSplitCard).not.toBe('undefined');
    expect(typeof fam8.hasFuse).not.toBe('undefined');
    expect(typeof fam8.getModesForModalSpell).not.toBe('undefined');
    expect(typeof fam8.getSplitCardHalves).not.toBe('undefined');
    expect(typeof fam8.modeRequiresTarget).not.toBe('undefined');
    expect(typeof fam8.parseModes).not.toBe('undefined');
  });

  it('shim re-exports the same runtime names', () => {
    expect(typeof shim.isModalSpell).not.toBe('undefined');
    expect(typeof shim.isSplitCard).not.toBe('undefined');
    expect(typeof shim.hasFuse).not.toBe('undefined');
    expect(typeof shim.getModesForModalSpell).not.toBe('undefined');
    expect(typeof shim.getSplitCardHalves).not.toBe('undefined');
    expect(typeof shim.modeRequiresTarget).not.toBe('undefined');
    expect(typeof shim.parseModes).not.toBe('undefined');
  });
  it('type surface compiles against the family module', () => {
    type _Surface = typeof famT8;
    expect(true).toBe(true);
  });
});

describe('oracle-text-parser/tribute-renown family surface', () => {
  it('exports every runtime member of the original module surface', () => {
    expect(typeof fam9.parseRenown).not.toBe('undefined');
    expect(typeof fam9.parseTribute).not.toBe('undefined');
  });

  it('shim re-exports the same runtime names', () => {
    expect(typeof shim.parseRenown).not.toBe('undefined');
    expect(typeof shim.parseTribute).not.toBe('undefined');
  });
  it('type surface compiles against the family module', () => {
    type _Surface = typeof famT9;
    expect(true).toBe(true);
  });
});

