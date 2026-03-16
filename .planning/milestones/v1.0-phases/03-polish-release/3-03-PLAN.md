# Plan 3.3: Documentation

## Objective
Create comprehensive user and developer documentation for Planar Nexus v1.0.

## Why This Matters
- Users need clear instructions for installation and usage (REQ-T4)
- Contributors need guidelines for code contributions
- Reduces support burden with self-service documentation
- Professional documentation builds trust

---

## Tasks

### Task 3.3.1: Audit Existing Documentation
**Type**: research
**Duration**: ~30 min

**Actions**:
1. List current documentation files:
   - README.md
   - CLAUDE.md
   - AI_*.md files
   - CARD_DATABASE_*.md files
   - COMPLETION_REPORT.md
   - PHASE_2_COMPLETION.md

2. Assess quality and completeness:
   - Installation instructions
   - Quick start guide
   - Feature documentation
   - API documentation

3. Identify gaps:
   - Missing user guide
   - Missing troubleshooting
   - Missing contributing guide

**Deliverable**: Documentation audit showing:
- Existing docs and quality
- Missing critical documentation
- Priority order for creation

---

### Task 3.3.2: Write README.md
**Type**: auto
**Duration**: ~60 min

**Actions**:
1. Create comprehensive README.md:
```markdown
# Planar Nexus

**Free open-source tabletop card game deck builder and tester with AI coaching**

[![Tests](badge-url)](actions-url)
[![Coverage](coverage-badge-url)](codecov-url)
[![License](license-badge-url)](license-url)

## Quick Start

### Install
1. Download installer for your platform:
   - **Windows**: [PlanarNexus_1.0.0.msi](download-url)
   - **macOS**: [PlanarNexus_1.0.0.dmg](download-url)
   - **Linux**: [planar-nexus_1.0.0.deb](download-url)

2. Run installer and launch app

### Build from Source
```bash
git clone https://github.com/your-org/planar-nexus
cd planar-nexus
npm install
npm run dev
```

## Features

### Deck Builder
- Search 500+ cards with filters
- Format validation (Commander, Standard, Modern, etc.)
- Mana curve and statistics
- Save and organize decks

### AI Coach
- Detect 18+ deck archetypes
- Identify 24+ card synergies
- Suggest missing synergy cards
- Export coach reports (text/PDF)

### AI Opponent
- 4 difficulty levels (Easy to Expert)
- Distinct behavioral profiles
- Full game playtesting
- Game history tracking

## Screenshots

![Deck Builder](screenshots/deck-builder.png)
![AI Coach](screenshots/ai-coach.png)
![AI Opponent](screenshots/ai-opponent.png)

## Requirements
- Windows 10+, macOS 10.13+, or Linux
- 4GB RAM minimum
- 500MB disk space

## Documentation
- [User Guide](docs/USER_GUIDE.md)
- [API Documentation](docs/API.md)
- [Contributing Guide](docs/CONTRIBUTING.md)
- [Troubleshooting](docs/TROUBLESHOOTING.md)

## License
MIT License - see [LICENSE](LICENSE) for details
```

2. Add screenshots (capture from running app)
3. Add badges for tests, coverage, license
4. Link to detailed documentation

**Verification**:
- README renders correctly on GitHub
- All links work
- Screenshots are clear

---

### Task 3.3.3: Write User Guide
**Type**: auto
**Duration**: ~90 min

**Actions**:
1. Create `docs/USER_GUIDE.md`:
```markdown
# User Guide

## Table of Contents
1. Getting Started
2. Deck Building
3. AI Coach
4. AI Opponent
5. Import/Export
6. Settings
7. Keyboard Shortcuts

## 1. Getting Started

### Installation
[Detailed installation steps per platform]

### First Launch
1. Launch Planar Nexus
2. Card database will initialize (first launch only)
3. Navigate to Deck Builder to start

### Interface Overview
[Screenshot with labeled sections]

## 2. Deck Building

### Creating a New Deck
1. Click "New Deck" button
2. Enter deck name
3. Select format (Commander, Standard, etc.)
4. Add cards using search

### Card Search
- Search by name
- Filter by color, CMC, type
- View card details

### Deck Validation
- Real-time format checking
- Warnings for illegal cards
- Statistics panel

### Saving Decks
- Auto-save on changes
- Manual save button
- Deck organization

## 3. AI Coach

### Getting Coach Feedback
1. Navigate to "Deck Coach"
2. Select deck to analyze
3. Wait for analysis (5-10 seconds)
4. Review report

### Understanding the Report
- Archetype badge
- Synergy list
- Missing synergies
- Key cards
- Improvement suggestions

### Exporting Reports
- Text format download
- PDF via print dialog

## 4. AI Opponent

### Starting a Game
1. Navigate to "Single Player"
2. Select your deck
3. Configure AI opponent:
   - Difficulty (Easy/Medium/Hard/Expert)
   - Theme (Aggro/Control/Combo, etc.)
4. Click "Start Game"

### Playing a Game
- Turn structure explained
- Priority system
- Combat walkthrough

### Difficulty Levels
- Easy: 80% player win rate
- Medium: 60% player win rate
- Hard: 40% player win rate
- Expert: 25% player win rate

## 5. Import/Export

### Importing Decklists
- From clipboard
- From file
- From URL

### Exporting Decks
- Text format
- JSON backup
- Share link

## 6. Settings

### General Settings
- Theme (light/dark)
- Language
- Card database management

### AI Settings
- API key configuration (optional)
- Difficulty preferences

## 7. Keyboard Shortcuts
| Shortcut | Action |
|----------|--------|
| Ctrl+N | New Deck |
| Ctrl+S | Save Deck |
| Ctrl+F | Search Cards |
| F5 | Refresh |
```

**Verification**:
- All features documented
- Screenshots included
- Steps are clear and reproducible

---

### Task 3.3.4: Write API Documentation
**Type**: auto
**Duration**: ~60 min

**Actions**:
1. Create `docs/API.md`:
```markdown
# API Documentation

## Overview
Planar Nexus uses a minimal server-side proxy for optional LLM features.

## Endpoints

### POST /api/ai/coach/review
Analyze deck and generate coach report

**Request**:
```json
{
  "deck": {
    "name": "Burn",
    "format": "standard",
    "cards": [
      {"name": "Lightning Bolt", "count": 4},
      ...
    ]
  },
  "provider": "openai" // or "google", "z-ai"
}
```

**Response**:
```json
{
  "archetype": {
    "primary": "Burn",
    "confidence": 0.85
  },
  "synergies": [...],
  "recommendations": [...]
}
```

### POST /api/ai/play
Get AI move recommendation

**Request**:
```json
{
  "gameState": {...},
  "playerId": "player-1"
}
```

**Response**:
```json
{
  "action": "cast_spell",
  "cardId": "card-123",
  "target": "opponent"
}
```

## AI Providers

### OpenAI
- Model: gpt-4o-mini
- Setup: Add OPENAI_API_KEY to .env

### Google (Gemini)
- Model: gemini-1.5-flash
- Setup: Add GOOGLE_API_KEY to .env

### Z.ai
- Model: glm-4-flash
- Setup: Add Z_API_KEY to .env

## Rate Limits
- Free tier: 10 requests/minute
- Configure in .env: AI_RATE_LIMIT=10
```

2. Document environment variables:
```markdown
## Environment Variables

```bash
# Required for AI features
OPENAI_API_KEY=sk-...
GOOGLE_API_KEY=...
Z_API_KEY=...

# Optional
AI_RATE_LIMIT=10
NODE_ENV=production
```

**Verification**:
- All endpoints documented
- Request/response examples clear
- Setup instructions complete

---

### Task 3.3.5: Write Contributing Guide
**Type**: auto
**Duration**: ~45 min

**Actions**:
1. Create `docs/CONTRIBUTING.md`:
```markdown
# Contributing to Planar Nexus

## Getting Started

### Prerequisites
- Node.js 20+
- npm or yarn
- Git

### Setup
```bash
git clone https://github.com/your-org/planar-nexus
cd planar-nexus
npm install
npm run dev
```

## Development

### Running Tests
```bash
# Unit tests
npm test

# E2E tests
npx playwright test

# Coverage
npm test -- --coverage
```

### Code Style
- ESLint configuration in `eslint.config.mjs`
- Prettier configuration in `.prettierrc`
- Run linting: `npm run lint`

### Project Structure
```
planar-nexus/
├── src/
│   ├── app/          # Next.js pages
│   ├── ai/           # AI modules
│   ├── lib/          # Utilities
│   └── components/   # React components
├── src-tauri/        # Tauri backend
├── docs/             # Documentation
└── .planning/        # GSD planning docs
```

## Making Changes

1. Fork the repository
2. Create feature branch: `git checkout -b feature/my-feature`
3. Make changes
4. Run tests: `npm test`
5. Commit: `git commit -m "Add my feature"`
6. Push: `git push origin feature/my-feature`
7. Open Pull Request

### Commit Messages
Follow conventional commits:
- `feat: Add new feature`
- `fix: Fix bug`
- `docs: Update documentation`
- `test: Add tests`
- `refactor: Refactor code`

## Pull Request Process

1. Ensure tests pass
2. Update documentation
3. Add changelog entry
4. Request review

## Code of Conduct

- Be respectful
- Welcome newcomers
- Focus on constructive feedback

## Questions?

Open an issue or join our [Discord](discord-url)
```

**Verification**:
- Setup instructions work
- Contribution process clear
- Code style documented

---

### Task 3.3.6: Write Troubleshooting Guide
**Type**: auto
**Duration**: ~45 min

**Actions**:
1. Create `docs/TROUBLESHOOTING.md`:
```markdown
# Troubleshooting Guide

## Installation Issues

### Windows: "SmartScreen prevented installation"
**Cause**: App not yet recognized by SmartScreen
**Solution**: Click "More info" → "Run anyway"
**Long-term**: Code signing will resolve this

### macOS: "App can't be opened"
**Cause**: Notarization or Gatekeeper issue
**Solution**:
1. Right-click app → Open
2. Click "Open" in dialog
3. Or: `xattr -d com.apple.quarantine /Applications/PlanarNexus.app`

### Linux: ".deb installation fails"
**Cause**: Missing dependencies
**Solution**:
```bash
sudo apt-get install -y libwebkit2gtk-4.0-37 libappindicator3-1
sudo dpkg -i planar-nexus_1.0.0_amd64.deb
```

## Card Database Issues

### "Card database failed to load"
**Cause**: IndexedDB corruption
**Solution**:
1. Open DevTools (F12)
2. Application → IndexedDB
3. Delete `planar-nexus` database
4. Refresh page

### "Card images not loading"
**Cause**: Image cache corruption
**Solution**:
1. Settings → Card Database
2. Click "Clear Image Cache"
3. Refresh page

## AI Features

### "AI coach not responding"
**Cause**: API key not configured or rate limit
**Solution**:
1. Check API key in Settings
2. Verify key is valid
3. Wait for rate limit reset
4. Fallback to heuristic analysis

### "AI opponent freezes"
**Cause**: Infinite loop in AI logic
**Solution**:
1. Refresh page
2. Report bug with deck details
3. Try different difficulty level

## Performance Issues

### "App runs slowly"
**Cause**: Large card database or memory leak
**Solution**:
1. Clear image cache
2. Close other browser tabs
3. Restart app
4. Report if persistent

### "High CPU usage"
**Cause**: AI thinking or rendering issue
**Solution**:
1. Wait for AI turn to complete
2. Check DevTools Performance tab
3. Report with steps to reproduce

## Multiplayer Issues

### "Can't connect to opponent"
**Cause**: Network or firewall issue
**Solution**:
1. Check internet connection
2. Disable firewall temporarily
3. Try different network
4. Use spectator mode as workaround

## Getting Help

- Check this troubleshooting guide
- Search existing issues
- Open new issue with:
  - Platform and version
  - Steps to reproduce
  - Expected vs actual behavior
  - Screenshots if applicable
```

**Verification**:
- Common issues covered
- Solutions are actionable
- Contact info provided

---

### Task 3.3.7: Documentation Review
**Type**: checkpoint:human-verify
**Duration**: ~30 min

**What Built**: Complete documentation set

**How to Verify**:
1. Read through all documentation:
   - README.md
   - docs/USER_GUIDE.md
   - docs/API.md
   - docs/CONTRIBUTING.md
   - docs/TROUBLESHOOTING.md

2. Verify:
   - All links work
   - Screenshots are clear
   - Instructions are reproducible
   - No typos or errors

3. Test documentation:
   - Follow installation steps on fresh machine
   - Build first deck using only user guide
   - Configure AI using API docs

**Resume Signal**: "Documentation complete" or list issues

---

## Success Criteria

✅ README.md comprehensive with screenshots
✅ User guide covers all features
✅ API documentation complete with examples
✅ Contributing guide clear and actionable
✅ Troubleshooting guide covers common issues
✅ All documentation linked from README
✅ No typos or broken links

---

## Dependencies

- Requires: Phase 2 complete (features stable)
- Unblocks: Plan 3.4 (Bug Bash uses documentation)

---

## Risks

| Risk | Mitigation |
|------|------------|
| Documentation outdated on release | Write after features complete |
| Screenshots look different | Use recent screenshots |
| Too much documentation | Focus on essential first |
| Not enough documentation | Add incrementally post-release |

---

**Created**: 2026-03-12
**Estimated Duration**: 4-6 hours
