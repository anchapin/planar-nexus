# Planar Nexus v1.0.0 Release Notes

**Release Date**: March 12, 2026

**🎉 Major Milestone**: First stable production release of Planar Nexus — your free, open-source tabletop card game deck builder and AI-powered playtester.

---

## 🚀 What's New

Planar Nexus v1.0.0 delivers a complete tabletop card game experience with AI coaching and playtesting capabilities. Build decks, get AI-powered meta analysis, and playtest against AI opponents — all in a legal-safe, client-side application distributable as desktop installers for Windows, Mac, and Linux.

### ✨ Core Features

#### 🃏 Deck Builder
- **500+ Card Database** — Comprehensive card library with offline support and instant fuzzy search
- **Format Validation** — Support for Commander, Standard, Modern, Legacy, and Vintage formats
- **Real-time Statistics** — Live mana curve visualization and deck analytics
- **Import/Export** — Multiple formats including text, JSON, MTGO, and clipboard integration
- **Unlimited Saves** — Store and organize unlimited decks locally with IndexedDB

#### 🤖 AI Deck Coach
- **18 Archetype Detection** — Automatically identifies deck archetypes (Aggro, Control, Combo, Tribal, etc.) with 70%+ confidence scoring
- **24 Synergy Patterns** — Detects card synergies with actionable recommendations and impact levels
- **Missing Synergy Alerts** — Suggests cards that would enhance your deck's strategy
- **Key Cards Analysis** — Highlights crucial cards and explains their roles
- **Export Reports** — Save coach analysis as text or PDF documents
- **Multi-Provider Support** — Compatible with Gemini, Claude, OpenAI, and Z.ai

#### ⚔️ AI Opponent
- **4 Difficulty Levels**:
  - **Easy**: 80% player win rate — beginner-friendly
  - **Medium**: 60% player win rate — balanced challenge
  - **Hard**: 40% player win rate — experienced players
  - **Expert**: 25% player win rate — near-perfect play
- **Full Gameplay AI** — Intelligent combat decisions and game state evaluation
- **Game History** — Track and replay past matches
- **Customizable Themes** — AI adapts to different playstyles (Aggro, Control, Combo)

#### 👥 Multiplayer
- **Peer-to-Peer WebRTC** — Direct connections without central game servers
- **Multiple Formats** — 1v1 and 4-player Commander support
- **Team Modes** — 2v2 and 3v3 team battles
- **Lobby System** — Create or join games with friend codes
- **Spectator Mode** — Watch matches and learn from other players
- **Auto-Host Migration** — Seamless gameplay when host disconnects

#### 🎨 Visual Experience
- **High-Resolution Cards** — Crisp card art display with proper scaling
- **Smooth Animations** — Attack/block animations and spell effects
- **Combat Text** — Visual feedback for damage and life changes
- **Customization** — Card sleeves, playmats, and theme options
- **Audio** — Sound effects and background music
- **Dark Mode** — Easy on the eyes for extended sessions

#### 🎯 AI vs AI Spectator
- **Watch AI Battles** — Observe two AI opponents play full games
- **Speed Controls** — Instant, fast, or normal playback speeds
- **Play-by-Play Commentary** — AI-generated commentary explaining moves
- **Export History** — Save and review AI matches

---

## 🛠️ Technical Details

### System Requirements

**Minimum**:
- **OS**: Windows 10 (64-bit), macOS 10.15+, or Linux (Ubuntu 20.04+)
- **Processor**: Intel Core i5 or equivalent
- **Memory**: 4 GB RAM
- **Storage**: 500 MB available space
- **Network**: Internet connection for initial setup (optional for offline play)

**Recommended**:
- **OS**: Windows 11, macOS 12+, or Linux (Ubuntu 22.04+)
- **Processor**: Intel Core i7 or equivalent
- **Memory**: 8 GB RAM
- **Storage**: 1 GB available space (for card image cache)

### Technology Stack

- **Frontend**: Next.js 15, React 19, TypeScript 5
- **UI Components**: Shadcn/ui with Radix primitives
- **Desktop**: Tauri 2.x for native installers
- **Database**: IndexedDB for offline-first storage
- **AI Integration**: Custom proxy with multiple LLM provider support
- **Testing**: Jest (unit tests), Playwright (E2E tests)

### Build & Install

#### From Source
```bash
# Clone the repository
git clone https://github.com/anchapin/planar-nexus.git
cd planar-nexus

# Install dependencies
npm install

# Development mode
npm run dev

# Build production desktop app
npm run build:tauri

# Platform-specific builds
npm run build:win      # Windows installer
npm run build:mac      # macOS universal binary
npm run build:linux    # Linux packages
```

#### Pre-built Installers

Download from [GitHub Releases](https://github.com/anchapin/planar-nexus/releases/tag/v1.0.0):

| Platform | File | Size |
|----------|------|------|
| Windows | `Planar-Nexus-setup.exe` | ~15 MB |
| macOS | `Planar-Nexus.dmg` | ~18 MB |
| Linux (deb) | `planar-nexus_1.0.0_amd64.deb` | ~12 MB |
| Linux (AppImage) | `planar-nexus_1.0.0.AppImage` | ~14 MB |

---

## 📊 Project Statistics

### Code Quality Metrics

| Metric | Value |
|--------|-------|
| **Unit Tests** | 926 passing (98.6% success rate) |
| **E2E Tests** | 31 passing (critical user flows) |
| **Code Coverage** | 29.3% overall, 53.72% AI modules |
| **TypeScript** | ✅ Zero errors |
| **ESLint** | ✅ Zero errors |
| **Build Status** | ✅ Successful |

### Documentation

- **Total Lines**: 3,918 lines of documentation
- **Documents**: 8 comprehensive guides
  - README.md (399 lines)
  - User Guide (718 lines)
  - API Reference (943 lines)
  - Contributing Guide (621 lines)
  - Troubleshooting (837 lines)
  - QA Checklist (~400 lines)

### Development Effort

- **Total Time**: ~59 hours (30% more efficient than estimated)
- **Plans Completed**: 16/16
- **Features Delivered**: All v1.0 requirements met
- **Bugs**: Zero critical or high-priority issues

---

## 🎯 v1.0 Requirements Delivered

| ID | Requirement | Status |
|----|-------------|--------|
| REQ-1 | Card Management | ✅ Complete |
| REQ-2 | Import/Export | ✅ Complete |
| REQ-3 | Deck Creation | ✅ Complete |
| REQ-4 | AI Coach | ✅ Complete |
| REQ-5 | AI Opponent | ✅ Complete |
| REQ-T | Technical Excellence | ✅ Complete |

---

## 🐛 Known Issues

### Medium Priority (Scheduled for v1.0.1)

1. **Card Database Test Data** — Test data seeding needs improvement
2. **E2E Test Flakiness** — Some timing and selector issues in automated tests
3. **Import/Export Round Trip** — E2E test coverage incomplete
4. **Multiplayer Lobby E2E** — Automated test coverage needs enhancement
5. **Coach Component Selectors** — E2E selectors need stabilization

### Low Priority (Future Releases)

1. Serialization test timestamp comparison
2. Coach component JSX parsing configuration
3. Cross-browser testing infrastructure
4. Cold start performance optimization
5. Bundle identifier configuration
6. Coverage targets for legacy code
7. Linux build dependency documentation
8. Code signing certificate setup

**Note**: No critical or high-priority bugs known at release time.

---

## 📦 Installation Guide

### Windows

1. Download `Planar-Nexus-setup.exe`
2. Run the installer
3. If SmartScreen appears:
   - Click "More info"
   - Click "Run anyway"
4. Follow installation prompts
5. Launch from Start Menu or Desktop

### macOS

1. Download `Planar-Nexus.dmg`
2. Open the DMG file
3. Drag Planar Nexus to Applications folder
4. If blocked by Gatekeeper:
   - Right-click the app
   - Click "Open"
   - Click "Open" in the dialog
5. Launch from Applications folder

### Linux

#### Debian/Ubuntu
```bash
wget https://github.com/anchapin/planar-nexus/releases/download/v1.0.0/planar-nexus_1.0.0_amd64.deb
sudo dpkg -i planar-nexus_1.0.0_amd64.deb
```

#### Any Linux (AppImage)
```bash
wget https://github.com/anchapin/planar-nexus/releases/download/v1.0.0/planar-nexus_1.0.0.AppImage
chmod +x planar-nexus_1.0.0.AppImage
./planar-nexus_1.0.0.AppImage
```

---

## 🎮 Quick Start Guide

### 1. First Launch

1. Launch Planar Nexus
2. (Optional) Configure AI providers in Settings
3. Browse the card database to explore available cards

### 2. Build Your First Deck

1. Navigate to **Deck Builder**
2. Search for cards using the search bar
3. Click cards to add them to your deck
4. Watch the mana curve update in real-time
5. Save your deck with a descriptive name

### 3. Get AI Coaching

1. Open your saved deck in **Deck Builder**
2. Click **AI Coach** tab
3. Review archetype analysis
4. Check synergy detections
5. Read improvement suggestions
6. Export report if desired

### 4. Playtest Against AI

1. Go to **Single Player**
2. Select your deck
3. Choose AI difficulty
4. Select AI archetype theme
5. Click **Start Game**
6. Play through your turns
7. Review game history afterward

### 5. Watch AI vs AI

1. Navigate to **Spectator**
2. Select two AI opponents
3. Choose playback speed
4. Enable commentary
5. Watch and learn!

---

## 🔗 Resources

### Documentation

- [User Guide](docs/USER_GUIDE.md) — Complete user manual
- [API Reference](docs/API.md) — Developer API documentation
- [Contributing Guide](docs/CONTRIBUTING.md) — How to contribute
- [Troubleshooting](docs/TROUBLESHOOTING.md) — Common issues and solutions
- [QA Checklist](docs/QA_CHECKLIST.md) — Quality assurance procedures

### Community

- **GitHub Repository**: https://github.com/anchapin/planar-nexus
- **Issue Tracker**: https://github.com/anchapin/planar-nexus/issues
- **Discussions**: https://github.com/anchapin/planar-nexus/discussions

### Support

- **Bug Reports**: File an issue on GitHub
- **Feature Requests**: Use GitHub Discussions
- **Questions**: GitHub Discussions or Discord (coming soon)

---

## 🙏 Acknowledgments

### Development Team

- **Primary Developer**: Built with Qwen Code using GSD methodology
- **AI Assistance**: Accelerated development through AI pair programming
- **Contributors**: Open-source community members

### Technologies

- **Next.js** — React framework
- **Tauri** — Desktop application framework
- **Shadcn/ui** — UI component library
- **Radix UI** — Accessible components
- **TypeScript** — Type safety
- **Jest & Playwright** — Testing frameworks

### Special Thanks

- All beta testers and early adopters
- Open-source maintainers of dependencies
- Community contributors and feedback providers

---

## 📜 License & Legal

### License

**MIT License** — Free to use, modify, and distribute

### Disclaimer

Planar Nexus is not affiliated with, endorsed by, or connected to Wizards of the Coast, Magic: The Gathering, or any of their affiliates. All Magic: The Gathering content is trademarked and copyrighted by Wizards of the Coast. This project is provided for educational and entertainment purposes only.

### Trademarks

All trademarks, registered trademarks, and service marks are the property of their respective owners. Use of these marks does not imply endorsement or affiliation.

---

## 🔮 What's Next

### v1.0.1 Patch (Coming Soon)

- Fix E2E test flakiness
- Improve card database test data
- Stabilize test selectors
- Address medium-priority issues

### v1.1 Roadmap

- **Custom Card Creation** — Design and create custom cards with AI artwork
- **Cloud Sync** — Optional cloud backup for decks (privacy-first)
- **Enhanced Multiplayer** — Matchmaking and ranked play
- **Achievement System** — Track milestones and accomplishments

### Future Vision (v2.0+)

- Campaign/tutorial mode
- Ranked ladder system
- Community deck sharing platform
- Mobile applications (iOS/Android)
- Enhanced AI with learning capabilities

---

## 📞 Contact

- **Email**: [Contact via GitHub]
- **Twitter**: [@YourHandle] (coming soon)
- **Discord**: [Invite Link] (coming soon)

---

**Thank you for using Planar Nexus! 🎉**

We hope you enjoy building decks, getting AI coaching, and playtesting against AI opponents. Your feedback helps us improve — please share your thoughts on GitHub!

**Happy Gaming!** 🃏✨
