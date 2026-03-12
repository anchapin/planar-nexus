# Plan 3.4: Bug Bash & QA

## Objective
Systematic quality assurance pass to identify and fix critical bugs before v1.0 release.

## Why This Matters
- Zero known crashes or data loss bugs required for v1.0
- Performance optimization improves user experience
- Cross-platform testing catches platform-specific issues
- Builds confidence in production release

---

## Tasks

### Task 3.4.1: Create QA Test Checklist
**Type**: auto
**Duration**: ~60 min

**Actions**:
1. Create `docs/QA_CHECKLIST.md`:
```markdown
# QA Test Checklist for v1.0.0

## Critical Flows (Must Pass)

### Installation
- [ ] Windows installer runs without errors
- [ ] macOS installer runs without errors
- [ ] Linux installer runs without errors
- [ ] App launches after installation
- [ ] No console errors on first launch

### Deck Building
- [ ] Search for cards returns results
- [ ] Add cards to deck
- [ ] Remove cards from deck
- [ ] Change card quantities
- [ ] Format validation works
- [ ] Save deck persists across sessions
- [ ] Load saved deck
- [ ] Delete deck with confirmation
- [ ] Duplicate deck creates copy

### Import/Export
- [ ] Import decklist from clipboard
- [ ] Import decklist from file
- [ ] Export deck as text
- [ ] Export deck as JSON
- [ ] Re-import exported deck
- [ ] MTGO format import works

### AI Coach
- [ ] Select deck for analysis
- [ ] Coach report generates in <10 seconds
- [ ] Archetype badge displays correctly
- [ ] Synergies list shows 3+ synergies
- [ ] Missing synergies have suggestions
- [ ] Key cards section displays
- [ ] Export report as text works
- [ ] Export report as PDF works

### AI Opponent
- [ ] Select deck for playtest
- [ ] Configure AI difficulty
- [ ] Configure AI theme
- [ ] Start game successfully
- [ ] Game initializes correctly
- [ ] Player can take mulligan
- [ ] Player can play lands
- [ ] Player can cast spells
- [ ] AI takes turns automatically
- [ ] Combat resolves correctly
- [ ] Game ends with win/loss/draw
- [ ] Game history saved

### Performance
- [ ] App loads in <3 seconds
- [ ] Card search returns in <100ms
- [ ] Deck save/load in <500ms
- [ ] AI coach report in <10 seconds
- [ ] No memory leaks in 30-minute session
- [ ] No crashes during extended play

## Edge Cases

### Deck Building
- [ ] Create deck with 0 cards (should warn)
- [ ] Create deck with 100+ cards (should warn)
- [ ] Add 4th copy of limited card (should warn)
- [ ] Add card illegal in format (should warn)
- [ ] Save deck with duplicate name (should handle)
- [ ] Delete deck while viewing it (should handle)

### AI Coach
- [ ] Analyze empty deck (should handle gracefully)
- [ ] Analyze 100-card deck (should complete)
- [ ] Analyze deck with unknown archetype (should show "Unknown")
- [ ] Export report with special characters in name

### AI Opponent
- [ ] AI with empty library (should lose to decking)
- [ ] Player with empty library (should lose to decking)
- [ ] AI with no legal plays (should pass)
- [ ] Combat with 0 attackers (should skip)
- [ ] Combat with 20+ creatures (should handle)
- [ ] Stack with 10+ objects (should resolve)

### Import/Export
- [ ] Import malformed decklist (should show error)
- [ ] Import decklist with unknown cards (should report)
- [ ] Export deck with special characters in name
- [ ] Import deck with illegal cards (should warn)

## Platform-Specific

### Windows
- [ ] Installer creates Start menu shortcut
- [ ] App appears in Add/Remove Programs
- [ ] Uninstaller removes all files
- [ ] No SmartScreen warnings (if signed)

### macOS
- [ ] DMG mounts correctly
- [ ] App copies to Applications
- [ ] App launches from Applications
- [ ] No Gatekeeper warnings (if notarized)

### Linux
- [ ] .deb installs with dpkg
- [ ] AppImage runs without installation
- [ ] Desktop entry created
- [ ] App appears in applications menu

## Accessibility
- [ ] Keyboard navigation works
- [ ] Focus indicators visible
- [ ] Color contrast sufficient
- [ ] Screen reader can read main content

## Error Handling
- [ ] Network error shows friendly message
- [ ] Database error shows recovery option
- [ ] Invalid input shows clear error
- [ ] 404 page exists and is helpful
- [ ] Crash recovery preserves data
```

2. Prioritize tests:
   - Critical (blocks release)
   - High (should fix before release)
   - Medium (nice to fix)
   - Low (can fix post-release)

**Verification**:
- Checklist covers all features
- Edge cases included
- Platform-specific tests listed

---

### Task 3.4.2: Run Critical Flow Tests
**Type**: checkpoint:human-verify
**Duration**: ~90 min

**What to Test**: All critical flows from QA checklist

**How to Verify**:
1. Follow each test step exactly
2. Record pass/fail for each test
3. Screenshot any failures
4. Note steps to reproduce bugs

**Resume Signal**: Paste test results:
```
Critical Flows: XX/XX passed
Edge Cases: XX/XX passed
Platform: XX/XX passed
Bugs Found: [list]
```

---

### Task 3.4.3: Performance Profiling
**Type**: auto
**Duration**: ~60 min

**Actions**:
1. Profile app load time:
```javascript
// In browser console
performance.mark('app-start');
// Wait for app to load
performance.mark('app-ready');
performance.measure('app-load', 'app-start', 'app-ready');
console.log(performance.getEntriesByName('app-load')[0].duration);
```

2. Profile card search:
```javascript
console.time('card-search');
// Perform search
console.timeEnd('card-search');
```

3. Profile AI coach:
```javascript
console.time('coach-analysis');
// Get coach report
console.timeEnd('coach-analysis');
```

4. Check memory usage:
   - Open DevTools → Memory
   - Take heap snapshot
   - Perform actions
   - Take another snapshot
   - Compare for leaks

5. Profile in Production:
```bash
npm run build
npm run start
# Run performance tests
```

**Deliverable**: Performance report showing:
- App load time
- Search response time
- Coach analysis time
- Memory usage baseline
- Any memory leaks identified

---

### Task 3.4.4: Fix Critical Bugs
**Type**: auto
**Duration**: ~120 min

**Actions**:
1. Triage bugs found in Task 3.4.2:
   - Critical (crash, data loss) → Fix immediately
   - High (broken feature) → Fix before release
   - Medium (minor issue) → Fix if time
   - Low (cosmetic) → Document for later

2. Fix bugs in priority order:
   - Create branch per bug
   - Fix and test
   - Commit with clear message
   - Merge to main

3. Verify fixes:
   - Re-run failing tests
   - Check for regressions

**Verification**:
- All critical bugs fixed
- High priority bugs fixed or documented
- No new bugs introduced

---

### Task 3.4.5: Cross-Platform Testing
**Type**: checkpoint:human-verify
**Duration**: ~60 min per platform

**What to Test**: Critical flows on each platform

**How to Verify**:

**Windows**:
1. Install on Windows 10/11
2. Run critical flow tests
3. Check for Windows-specific issues:
   - File paths
   - Keyboard shortcuts
   - Font rendering

**macOS**:
1. Install on macOS 10.13+
2. Run critical flow tests
3. Check for macOS-specific issues:
   - Menu bar integration
   - Trackpad gestures
   - Retina display

**Linux**:
1. Install on Ubuntu 20.04+ (or preferred distro)
2. Run critical flow tests
3. Check for Linux-specific issues:
   - System tray integration
   - Window manager compatibility
   - Font rendering

**Resume Signal**: Paste platform test results:
```
Windows: ✓/✗ Issues: ...
macOS: ✓/✗ Issues: ...
Linux: ✓/✗ Issues: ...
```

---

### Task 3.4.6: Stress Testing
**Type**: auto
**Duration**: ~60 min

**Actions**:
1. Large deck test:
   - Create 100-card deck
   - Get coach report
   - Play game with deck
   - Verify no crashes

2. Long session test:
   - Play 10 consecutive games
   - Monitor memory usage
   - Check for slowdowns
   - Verify no crashes

3. Rapid input test:
   - Click buttons rapidly
   - Type in search rapidly
   - Switch tabs quickly
   - Verify no race conditions

4. Network throttling test:
   - DevTools → Network → Slow 3G
   - Test AI coach
   - Test import/export
   - Verify graceful degradation

**Deliverable**: Stress test report showing:
- Maximum deck size handled
- Maximum session duration
- Any crashes or hangs
- Network failure handling

---

### Task 3.4.7: Final QA Sign-off
**Type**: checkpoint:human-verify
**Duration**: ~30 min

**What Built**: Polished, tested application

**How to Verify**:
1. Review all QA results:
   - Critical flows: 100% passing
   - Edge cases: 90%+ passing
   - Performance: Meets targets
   - Bugs: All critical fixed

2. Verify release readiness:
   - [ ] No crash bugs
   - [ ] No data loss bugs
   - [ ] No security issues
   - [ ] Performance acceptable
   - [ ] Documentation complete
   - [ ] Installers working

3. Make release decision:
   - Ready for v1.0 release
   - Ready with known issues (document)
   - Not ready (list blockers)

**Resume Signal**: "QA sign-off complete. Ready for v1.0 release" or list blockers

---

## Success Criteria

✅ QA checklist 100% complete for critical flows
✅ All critical bugs fixed
✅ Performance meets targets:
   - App load <3 seconds
   - Search <100ms
   - Coach <10 seconds
✅ No memory leaks in 30-minute session
✅ Cross-platform testing complete
✅ Stress testing complete
✅ Documentation updated with known issues

---

## Dependencies

- Requires: Plan 3.1 (tests passing)
- Requires: Plan 3.2 (production installers)
- Requires: Plan 3.3 (documentation complete)
- Unblocks: v1.0 release

---

## Risks

| Risk | Mitigation |
|------|------------|
| Too many critical bugs | Delay release, fix bugs |
| Platform-specific issues | Document, fix in patch release |
| Performance not meeting targets | Optimize critical paths |
| Stress test reveals crashes | Fix before release |

---

## Bug Severity Definitions

**Critical**:
- App crash
- Data loss
- Security vulnerability
- Blocks core feature

**High**:
- Feature broken
- Major functionality impaired
- Affects many users

**Medium**:
- Minor functionality impaired
- Workaround exists
- Affects some users

**Low**:
- Cosmetic issue
- Typo
- Minor inconvenience

---

**Created**: 2026-03-12
**Estimated Duration**: 6-8 hours
