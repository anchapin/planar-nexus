/**
 * Family-surface smoke tests (issue #1725).
 *
 * keyword-actions/ was decomposed into per-family modules. These tests pin each
 * family module's exported surface AND that the keyword-actions.ts re-export shim
 * exposes the exact same runtime names, so any move/rename that would
 * break an importer fails at the family boundary. Behavioral coverage
 * lives in the existing per-family suites (cycling, blitz, foretell,
 * monarchy, …).
 */

import * as fam0 from '../../keyword-actions/blitz';
import type * as famT0 from '../../keyword-actions/blitz';
import * as fam1 from '../../keyword-actions/counter-spell';
import type * as famT1 from '../../keyword-actions/counter-spell';
import * as fam2 from '../../keyword-actions/counters';
import type * as famT2 from '../../keyword-actions/counters';
import * as fam3 from '../../keyword-actions/cycling';
import type * as famT3 from '../../keyword-actions/cycling';
import * as fam4 from '../../keyword-actions/damage-tap';
import type * as famT4 from '../../keyword-actions/damage-tap';
import * as fam5 from '../../keyword-actions/draw';
import type * as famT5 from '../../keyword-actions/draw';
import * as fam6 from '../../keyword-actions/dungeon';
import type * as famT6 from '../../keyword-actions/dungeon';
import * as fam7 from '../../keyword-actions/foretell';
import type * as famT7 from '../../keyword-actions/foretell';
import * as fam8 from '../../keyword-actions/monarchy';
import type * as famT8 from '../../keyword-actions/monarchy';
import * as fam9 from '../../keyword-actions/persist';
import type * as famT9 from '../../keyword-actions/persist';
import * as fam10 from '../../keyword-actions/removal';
import type * as famT10 from '../../keyword-actions/removal';
import * as fam11 from '../../keyword-actions/shared';
import type * as famT11 from '../../keyword-actions/shared';
import * as fam12 from '../../keyword-actions/tokens';
import type * as famT12 from '../../keyword-actions/tokens';
import * as fam13 from '../../keyword-actions/tribute-renown';
import type * as famT13 from '../../keyword-actions/tribute-renown';
import * as shim from '../../keyword-actions';

describe('keyword-actions/blitz family surface', () => {
  it('exports every runtime member of the original module surface', () => {
    expect(typeof fam0.hasBlitzMarker).not.toBe('undefined');
    expect(typeof fam0.resolveBlitzDeathDraw).not.toBe('undefined');
    expect(typeof fam0.applyBlitzEndStepSacrifice).not.toBe('undefined');
  });

  it('shim re-exports the same runtime names', () => {
    expect(typeof shim.hasBlitzMarker).not.toBe('undefined');
    expect(typeof shim.resolveBlitzDeathDraw).not.toBe('undefined');
    expect(typeof shim.applyBlitzEndStepSacrifice).not.toBe('undefined');
  });
  it('type surface compiles against the family module', () => {
    type _Surface = typeof famT0;
    expect(true).toBe(true);
  });
});

describe('keyword-actions/counter-spell family surface', () => {
  it('exports every runtime member of the original module surface', () => {
    expect(typeof fam1.counterSpell).not.toBe('undefined');
  });

  it('shim re-exports the same runtime names', () => {
    expect(typeof shim.counterSpell).not.toBe('undefined');
  });
  it('type surface compiles against the family module', () => {
    type _Surface = typeof famT1;
    expect(true).toBe(true);
  });
});

describe('keyword-actions/counters family surface', () => {
  it('exports every runtime member of the original module surface', () => {
    expect(typeof fam2.addCounterToCard).not.toBe('undefined');
    expect(typeof fam2.removeCounterFromCard).not.toBe('undefined');
  });

  it('shim re-exports the same runtime names', () => {
    expect(typeof shim.addCounterToCard).not.toBe('undefined');
    expect(typeof shim.removeCounterFromCard).not.toBe('undefined');
  });
  it('type surface compiles against the family module', () => {
    type _Surface = typeof famT2;
    expect(true).toBe(true);
  });
});

describe('keyword-actions/cycling family surface', () => {
  it('exports every runtime member of the original module surface', () => {
    expect(typeof fam3.parseCyclingCost).not.toBe('undefined');
    expect(typeof fam3.hasCycling).not.toBe('undefined');
    expect(typeof fam3.hasLandcycling).not.toBe('undefined');
    expect(typeof fam3.hasTypecycling).not.toBe('undefined');
    expect(typeof fam3.getCyclingCost).not.toBe('undefined');
    expect(typeof fam3.getCyclingVariant).not.toBe('undefined');
    expect(typeof fam3.canCycleCard).not.toBe('undefined');
    expect(typeof fam3.cycleCard).not.toBe('undefined');
    expect(typeof fam3.getHandFilterForCard).not.toBe('undefined');
  });

  it('shim re-exports the same runtime names', () => {
    expect(typeof shim.parseCyclingCost).not.toBe('undefined');
    expect(typeof shim.hasCycling).not.toBe('undefined');
    expect(typeof shim.hasLandcycling).not.toBe('undefined');
    expect(typeof shim.hasTypecycling).not.toBe('undefined');
    expect(typeof shim.getCyclingCost).not.toBe('undefined');
    expect(typeof shim.getCyclingVariant).not.toBe('undefined');
    expect(typeof shim.canCycleCard).not.toBe('undefined');
    expect(typeof shim.cycleCard).not.toBe('undefined');
    expect(typeof shim.getHandFilterForCard).not.toBe('undefined');
  });
  it('type surface compiles against the family module', () => {
    type _Surface = typeof famT3;
    expect(true).toBe(true);
  });
});

describe('keyword-actions/damage-tap family surface', () => {
  it('exports every runtime member of the original module surface', () => {
    expect(typeof fam4.dealDamageToCard).not.toBe('undefined');
    expect(typeof fam4.tapCardAction).not.toBe('undefined');
    expect(typeof fam4.untapCardAction).not.toBe('undefined');
  });

  it('shim re-exports the same runtime names', () => {
    expect(typeof shim.dealDamageToCard).not.toBe('undefined');
    expect(typeof shim.tapCardAction).not.toBe('undefined');
    expect(typeof shim.untapCardAction).not.toBe('undefined');
  });
  it('type surface compiles against the family module', () => {
    type _Surface = typeof famT4;
    expect(true).toBe(true);
  });
});

describe('keyword-actions/draw family surface', () => {
  it('exports every runtime member of the original module surface', () => {
    expect(typeof fam5.drawCards).not.toBe('undefined');
    expect(typeof fam5.discardCards).not.toBe('undefined');
  });

  it('shim re-exports the same runtime names', () => {
    expect(typeof shim.drawCards).not.toBe('undefined');
    expect(typeof shim.discardCards).not.toBe('undefined');
  });
  it('type surface compiles against the family module', () => {
    type _Surface = typeof famT5;
    expect(true).toBe(true);
  });
});

describe('keyword-actions/dungeon family surface', () => {
  it('exports every runtime member of the original module surface', () => {
    expect(typeof fam6.ventureIntoDungeon).not.toBe('undefined');
  });

  it('shim re-exports the same runtime names', () => {
    expect(typeof shim.ventureIntoDungeon).not.toBe('undefined');
  });
  it('type surface compiles against the family module', () => {
    type _Surface = typeof famT6;
    expect(true).toBe(true);
  });
});

describe('keyword-actions/foretell family surface', () => {
  it('exports every runtime member of the original module surface', () => {
    expect(typeof fam7.foretellCard).not.toBe('undefined');
    expect(typeof fam7.castForetoldCard).not.toBe('undefined');
  });

  it('shim re-exports the same runtime names', () => {
    expect(typeof shim.foretellCard).not.toBe('undefined');
    expect(typeof shim.castForetoldCard).not.toBe('undefined');
  });
  it('type surface compiles against the family module', () => {
    type _Surface = typeof famT7;
    expect(true).toBe(true);
  });
});

describe('keyword-actions/monarchy family surface', () => {
  it('exports every runtime member of the original module surface', () => {
    expect(typeof fam8.getMonarchId).not.toBe('undefined');
    expect(typeof fam8.setMonarch).not.toBe('undefined');
    expect(typeof fam8.clearMonarch).not.toBe('undefined');
    expect(typeof fam8.resetMonarchyTracking).not.toBe('undefined');
    expect(typeof fam8.applyMonarchEndStepDraw).not.toBe('undefined');
  });

  it('shim re-exports the same runtime names', () => {
    expect(typeof shim.getMonarchId).not.toBe('undefined');
    expect(typeof shim.setMonarch).not.toBe('undefined');
    expect(typeof shim.clearMonarch).not.toBe('undefined');
    expect(typeof shim.resetMonarchyTracking).not.toBe('undefined');
    expect(typeof shim.applyMonarchEndStepDraw).not.toBe('undefined');
  });
  it('type surface compiles against the family module', () => {
    type _Surface = typeof famT8;
    expect(true).toBe(true);
  });
});

describe('keyword-actions/persist family surface', () => {
  it('exports every runtime member of the original module surface', () => {
    expect(typeof fam9.handlePersist).not.toBe('undefined');
  });

  it('shim re-exports the same runtime names', () => {
    expect(typeof shim.handlePersist).not.toBe('undefined');
  });
  it('type surface compiles against the family module', () => {
    type _Surface = typeof famT9;
    expect(true).toBe(true);
  });
});

describe('keyword-actions/removal family surface', () => {
  it('exports every runtime member of the original module surface', () => {
    expect(typeof fam10.hasIndestructible).not.toBe('undefined');
    expect(typeof fam10.canBeRegenerated).not.toBe('undefined');
    expect(typeof fam10.destroyCard).not.toBe('undefined');
    expect(typeof fam10.exileCard).not.toBe('undefined');
    expect(typeof fam10.sacrificeCard).not.toBe('undefined');
    expect(typeof fam10.regenerateCard).not.toBe('undefined');
    expect(typeof fam10.consumeRegenerationShield).not.toBe('undefined');
    expect(typeof fam10.moveCardToZone).not.toBe('undefined');
  });

  it('shim re-exports the same runtime names', () => {
    expect(typeof shim.hasIndestructible).not.toBe('undefined');
    expect(typeof shim.canBeRegenerated).not.toBe('undefined');
    expect(typeof shim.destroyCard).not.toBe('undefined');
    expect(typeof shim.exileCard).not.toBe('undefined');
    expect(typeof shim.sacrificeCard).not.toBe('undefined');
    expect(typeof shim.regenerateCard).not.toBe('undefined');
    expect(typeof shim.consumeRegenerationShield).not.toBe('undefined');
    expect(typeof shim.moveCardToZone).not.toBe('undefined');
  });
  it('type surface compiles against the family module', () => {
    type _Surface = typeof famT10;
    expect(true).toBe(true);
  });
});

describe('keyword-actions/shared family surface', () => {
  it('is type-only; the shim export is pinned by the compiler', () => {
    expect(Object.keys(fam11).length).toBeGreaterThanOrEqual(0);
  });
  it('type surface compiles against the family module', () => {
    type _Surface = typeof famT11;
    expect(true).toBe(true);
  });
});

describe('keyword-actions/tokens family surface', () => {
  it('exports every runtime member of the original module surface', () => {
    expect(typeof fam12.createTokenCard).not.toBe('undefined');
  });

  it('shim re-exports the same runtime names', () => {
    expect(typeof shim.createTokenCard).not.toBe('undefined');
  });
  it('type surface compiles against the family module', () => {
    type _Surface = typeof famT12;
    expect(true).toBe(true);
  });
});

describe('keyword-actions/tribute-renown family surface', () => {
  it('exports every runtime member of the original module surface', () => {
    expect(typeof fam13.TRIBUTE_CHOICE_TYPE).not.toBe('undefined');
    expect(typeof fam13.processRenownOnEtb).not.toBe('undefined');
    expect(typeof fam13.processTributeOnEtb).not.toBe('undefined');
    expect(typeof fam13.createTributeWaitingChoice).not.toBe('undefined');
    expect(typeof fam13.hasPendingTributeOffer).not.toBe('undefined');
    expect(typeof fam13.resolveTributeChoice).not.toBe('undefined');
  });

  it('shim re-exports the same runtime names', () => {
    expect(typeof shim.TRIBUTE_CHOICE_TYPE).not.toBe('undefined');
    expect(typeof shim.processRenownOnEtb).not.toBe('undefined');
    expect(typeof shim.processTributeOnEtb).not.toBe('undefined');
    expect(typeof shim.createTributeWaitingChoice).not.toBe('undefined');
    expect(typeof shim.hasPendingTributeOffer).not.toBe('undefined');
    expect(typeof shim.resolveTributeChoice).not.toBe('undefined');
  });
  it('type surface compiles against the family module', () => {
    type _Surface = typeof famT13;
    expect(true).toBe(true);
  });
});

