/**
 * Family-surface smoke tests (issue #1725).
 *
 * spell-casting/ was decomposed into per-family modules. These tests pin each
 * family module's exported surface AND that the spell-casting.ts re-export shim
 * exposes the exact same runtime names, so any move/rename that would
 * break an importer fails at the family boundary. Behavioral coverage
 * lives in the existing per-family suites (cycling, blitz, foretell,
 * monarchy, …).
 */

import * as fam0 from '../../spell-casting/board-sweepers';
import type * as famT0 from '../../spell-casting/board-sweepers';
import * as fam1 from '../../spell-casting/cast';
import type * as famT1 from '../../spell-casting/cast';
import * as fam2 from '../../spell-casting/choices';
import type * as famT2 from '../../spell-casting/choices';
import * as fam3 from '../../spell-casting/resolve';
import type * as famT3 from '../../spell-casting/resolve';
import * as fam4 from '../../spell-casting/targeting';
import type * as famT4 from '../../spell-casting/targeting';
import * as shim from '../../spell-casting';

describe('spell-casting/board-sweepers family surface', () => {
  it('exports every runtime member of the original module surface', () => {
    expect(typeof fam0.isBoardSweeper).not.toBe('undefined');
    expect(typeof fam0.destroysIndestructibleCreatures).not.toBe('undefined');
    expect(typeof fam0.executeBoardSweeper).not.toBe('undefined');
  });

  it('shim re-exports the same runtime names', () => {
    expect(typeof shim.isBoardSweeper).not.toBe('undefined');
    expect(typeof shim.destroysIndestructibleCreatures).not.toBe('undefined');
    expect(typeof shim.executeBoardSweeper).not.toBe('undefined');
  });
  it('type surface compiles against the family module', () => {
    type _Surface = typeof famT0;
    expect(true).toBe(true);
  });
});

describe('spell-casting/cast family surface', () => {
  it('exports every runtime member of the original module surface', () => {
    expect(typeof fam1.generateStackObjectId).not.toBe('undefined');
    expect(typeof fam1.canCastSpell).not.toBe('undefined');
    expect(typeof fam1.castSpell).not.toBe('undefined');
    expect(typeof fam1.getSpellManaValueFromCard).not.toBe('undefined');
  });

  it('shim re-exports the same runtime names', () => {
    expect(typeof shim.generateStackObjectId).not.toBe('undefined');
    expect(typeof shim.canCastSpell).not.toBe('undefined');
    expect(typeof shim.castSpell).not.toBe('undefined');
    expect(typeof shim.getSpellManaValueFromCard).not.toBe('undefined');
  });
  it('type surface compiles against the family module', () => {
    type _Surface = typeof famT1;
    expect(true).toBe(true);
  });
});

describe('spell-casting/choices family surface', () => {
  it('exports every runtime member of the original module surface', () => {
    expect(typeof fam2.createModeChoice).not.toBe('undefined');
    expect(typeof fam2.createChooseTwoModeChoice).not.toBe('undefined');
    expect(typeof fam2.createModalSpellChoice).not.toBe('undefined');
    expect(typeof fam2.createXValueChoice).not.toBe('undefined');
    expect(typeof fam2.resolveWaitingChoice).not.toBe('undefined');
  });

  it('shim re-exports the same runtime names', () => {
    expect(typeof shim.createModeChoice).not.toBe('undefined');
    expect(typeof shim.createChooseTwoModeChoice).not.toBe('undefined');
    expect(typeof shim.createModalSpellChoice).not.toBe('undefined');
    expect(typeof shim.createXValueChoice).not.toBe('undefined');
    expect(typeof shim.resolveWaitingChoice).not.toBe('undefined');
  });
  it('type surface compiles against the family module', () => {
    type _Surface = typeof famT2;
    expect(true).toBe(true);
  });
});

describe('spell-casting/resolve family surface', () => {
  it('exports every runtime member of the original module surface', () => {
    expect(typeof fam3.copySpellOnStack).not.toBe('undefined');
    expect(typeof fam3.resolveTopOfStack).not.toBe('undefined');
  });

  it('shim re-exports the same runtime names', () => {
    expect(typeof shim.copySpellOnStack).not.toBe('undefined');
    expect(typeof shim.resolveTopOfStack).not.toBe('undefined');
  });
  it('type surface compiles against the family module', () => {
    type _Surface = typeof famT3;
    expect(true).toBe(true);
  });
});

describe('spell-casting/targeting family surface', () => {
  it('exports every runtime member of the original module surface', () => {
    expect(typeof fam4.canTarget).not.toBe('undefined');
    expect(typeof fam4.createTargetingChoice).not.toBe('undefined');
    expect(typeof fam4.getValidTargets).not.toBe('undefined');
    expect(typeof fam4.validateSpellTargets).not.toBe('undefined');
  });

  it('shim re-exports the same runtime names', () => {
    expect(typeof shim.canTarget).not.toBe('undefined');
    expect(typeof shim.createTargetingChoice).not.toBe('undefined');
    expect(typeof shim.getValidTargets).not.toBe('undefined');
    expect(typeof shim.validateSpellTargets).not.toBe('undefined');
  });
  it('type surface compiles against the family module', () => {
    type _Surface = typeof famT4;
    expect(true).toBe(true);
  });
});

