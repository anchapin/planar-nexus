# Planar Nexus

**Free open-source tabletop card game deck builder and AI-powered playtester**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Tests](https://img.shields.io/badge/tests-140%20passing-brightgreen)](https://github.com/planar-nexus/planar-nexus/actions/workflows/ci.yml)
[![Coverage](https://img.shields.io/badge/coverage-70%25-brightgreen)](https://github.com/planar-nexus/planar-nexus/actions/workflows/ci.yml)
[![Next.js 15](https://img.shields.io/badge/Next.js-15-black?logo=next.js)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-blue?logo=typescript)](https://www.typescriptlang.org/)

> **WotC Fan Content Policy Disclaimer**: Planar Nexus is unofficial Fan Content permitted under the Fan Content Policy. Not approved/endorsed by Wizards. Portions of the materials used are property of Wizards of the Coast. ©Wizards of the Coast LLC.

---

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Quick Start](#quick-start)
- [Installation](#installation)
- [Screenshots](#screenshots)
- [Documentation](#documentation)
- [Requirements](#requirements)
- [Development](#development)
- [License](#license)

---

## Overview

Planar Nexus is a comprehensive digital tabletop card game experience built with Next.js 15, TypeScript, and Tauri. Build decks, get AI-powered coaching, play against AI opponents, and compete with friends online.

**Key Highlights**:

- **500+ card database** with offline support and instant fuzzy search
- **18 deck archetype detection** with 70%+ confidence scoring
- **24 synergy patterns** with actionable recommendations
- **4 AI difficulty levels** from beginner-friendly to expert
- **Full multiplayer** with P2P WebRTC (no central game server)
- **Privacy-first** - all data stored locally, bring your own AI keys

---

## Features

### Deck Builder

- Search 500+ cards with instant fuzzy matching
- Format validation for Commander, Standard, Modern, Legacy, and Vintage
- Real-time mana curve and deck statistics
- Import/export decklists (text, JSON, URL)
- Save and organize unlimited decks locally
- Offline-capable with IndexedDB storage

### AI Deck Coach

- Detects 18 deck archetypes (Aggro, Control, Combo, Tribal, etc.)
- Identifies 24+ synergy patterns with scoring
- Suggests missing synergy cards with impact levels
- Highlights key cards and their roles
- Export reports as text or PDF
- Multiple AI providers: Gemini, Claude, OpenAI, Z.ai

### AI Opponent

- 4 difficulty levels with distinct behavioral profiles:
  - **Easy**: 80% player win rate, beginner-friendly
  - **Medium**: 60% player win rate, balanced challenge
  - **Hard**: 40% player win rate, experienced players
  - **Expert**: 25% player win rate, near-perfect play
- Full game AI with intelligent combat decisions
- Game history tracking and replay analysis
- Customizable AI themes (Aggro, Control, Combo)

### Multiplayer

- Peer-to-peer WebRTC connections (no central server)
- 1v1 and 4-player Commander formats
- 2v2 teams mode
- Lobby system with game codes
- Spectator mode for observers
- Friends list and match history

### Visual Experience

- High-resolution card art display
- Attack/block animations
- Spell casting effects and combat text
- Customizable card sleeves and playmats
- Sound effects and background music
- Dark mode interface

---

## Quick Start

### Option 1: Download Pre-built Installer (Recommended)

1. **Download** the installer for your platform from [GitHub Releases](https://github.com/anchapin/planar-nexus/releases)
   - **Windows**: `Planar-Nexus-setup.exe`
   - **macOS**: `Planar-Nexus.dmg`
   - **Linux**: `planar-nexus_1.0.0_amd64.deb` or `.AppImage`

2. **Run** the installer and follow the prompts

3. **Launch** Planar Nexus and start building decks!

### Option 2: Web Version

Visit the hosted web version at [planarnexus.app](https://planarnexus.app) (if available)

### Option 3: Build from Source

See [Development](#development) section below.

---

## Installation

### System Requirements

| Platform    | Minimum Requirements                                   |
| ----------- | ------------------------------------------------------ |
| **Windows** | Windows 10+ (64-bit), 4GB RAM, 500MB disk space        |
| **macOS**   | macOS 10.15+ (Catalina), 4GB RAM, 500MB disk space     |
| **Linux**   | Ubuntu 22.04+ or equivalent, 4GB RAM, 500MB disk space |
| **Web**     | Modern browser (Chrome, Firefox, Safari, Edge)         |

### Windows Installation

1. Download `Planar-Nexus-setup.exe` from [Releases](https://github.com/anchapin/planar-nexus/releases)
2. Run the installer
3. If SmartScreen warns, click "More info" → "Run anyway"
4. Follow installation prompts
5. Launch from Start Menu or Desktop

### macOS Installation

1. Download `Planar-Nexus.dmg` from [Releases](https://github.com/anchapin/planar-nexus/releases)
2. Open the DMG file
3. Drag Planar Nexus to Applications folder
4. If Gatekeeper blocks, right-click → Open → Open
5. Launch from Applications folder

### Linux Installation

**Debian/Ubuntu**:

```bash
# Download the .deb file
wget https://github.com/anchapin/planar-nexus/releases/download/v1.0.0/planar-nexus_1.0.0_amd64.deb

# Install dependencies
sudo apt-get install -y libwebkit2gtk-4.1-dev libappindicator3-dev

# Install the package
sudo dpkg -i planar-nexus_1.0.0_amd64.deb
```

**AppImage** (works on most distributions):

```bash
# Download the AppImage
wget https://github.com/anchapin/planar-nexus/releases/download/v1.0.0/Planar-Nexus.AppImage

# Make executable
chmod +x Planar-Nexus.AppImage

# Run
./Planar-Nexus.AppImage
```

---

## Screenshots

### Deck Builder

![Deck Builder](docs/screenshots/deck-builder.png)
_Build and validate decks with instant card search and format checking_

### AI Coach Report

![AI Coach](docs/screenshots/ai-coach.png)
_Get intelligent deck analysis with archetype detection and synergy suggestions_

### AI Opponent Gameplay

![AI Opponent](docs/screenshots/ai-opponent.png)
_Play against AI with 4 difficulty levels and distinct behavioral profiles_

### Multiplayer Lobby

![Multiplayer](docs/screenshots/multiplayer.png)
_Create or join games with friends via P2P WebRTC connections_

---

## Documentation

| Document                                         | Description                                   |
| ------------------------------------------------ | --------------------------------------------- |
| [User Guide](docs/USER_GUIDE.md)                 | Complete guide to using Planar Nexus features |
| [API Documentation](docs/API.md)                 | AI provider configuration and API reference   |
| [Contributing Guide](docs/CONTRIBUTING.md)       | How to contribute code and documentation      |
| [Troubleshooting](docs/TROUBLESHOOTING.md)       | Common issues and solutions                   |
| [Deployment Guide](docs/DEPLOYMENT_GUIDE.md)     | Building and deploying for all platforms      |
| [Distribution Guide](docs/DISTRIBUTION_GUIDE.md) | Release management and distribution channels  |

---

## Requirements

### Runtime Requirements

- **Node.js**: 20 or higher (for development)
- **Browser**: Chrome 90+, Firefox 88+, Safari 14+, Edge 90+
- **Storage**: 500MB for application + card database
- **Memory**: 4GB RAM minimum, 8GB recommended
- **Network**: Internet connection for initial card database import (optional)

### Development Requirements

- **Node.js**: 20+
- **npm** or **yarn**
- **Git**
- **Rust toolchain** (for Tauri builds)
- **Platform-specific build tools** (see [Deployment Guide](docs/DEPLOYMENT_GUIDE.md))

---

## Development

### Clone and Setup

```bash
# Clone the repository
git clone https://github.com/anchapin/planar-nexus
cd planar-nexus

# Install dependencies
npm install
```

### Development Server

```bash
# Start development server (runs on port 9002)
npm run dev

# Start AI development UI (Genkit)
npm run genkit:dev

# Start AI development with hot-reload
npm run genkit:watch
```

### Build Commands

```bash
# Production build
NODE_ENV=production npm run build

# Start production server
npm start

# Build Tauri desktop app
npm run build:tauri

# Build for specific platform
npm run build:win      # Windows
npm run build:mac      # macOS
npm run build:linux    # Linux
```

### Testing

```bash
# Run unit tests
npm test

# Run tests with coverage
npm test -- --coverage

# Run E2E tests
npx playwright test

# Watch mode
npm run test:watch
```

#### Coverage Goals

The project enforces the following coverage thresholds:

| Metric     | Target |
| ---------- | ------ |
| Lines      | 70%    |
| Functions  | 70%    |
| Statements | 70%    |
| Branches   | 60%    |

Coverage reports are generated in:

- `coverage/lcov-report/index.html` - HTML report
- `coverage/lcov.info` - LCOV format for CI tools

See [TESTING.md](./TESTING.md) for comprehensive testing documentation, patterns, and best practices.

### Linting and Type Checking

```bash
# ESLint
npm run lint

# TypeScript type check
npm run typecheck
```

### Project Structure

```
planar-nexus/
├── src/
│   ├── app/              # Next.js app router pages
│   │   ├── (app)/        # Protected routes with shared layout
│   │   │   ├── dashboard/
│   │   │   ├── deck-builder/
│   │   │   ├── deck-coach/
│   │   │   ├── single-player/
│   │   │   └── multiplayer/
│   │   ├── api/          # API routes
│   │   └── actions.ts    # Server actions
│   ├── ai/               # AI modules
│   │   ├── providers/    # AI provider implementations
│   │   ├── flows/        # Genkit AI flows
│   │   └── difficulty.ts # AI difficulty configuration
│   ├── lib/              # Utilities and shared code
│   │   ├── game-state/   # Game engine
│   │   ├── card-database.ts
│   │   └── utils.ts
│   └── components/       # React components
│       └── ui/           # Shadcn/ui components
├── src-tauri/            # Tauri backend
├── docs/                 # Documentation
├── .planning/            # GSD planning documents
├── scripts/              # Utility scripts
└── public/               # Static assets
```

### Import Card Database

Planar Nexus starts with an empty card database. Import cards for personal use:

```bash
# Fetch 500 Commander-legal cards
npx tsx scripts/fetch-cards-for-db.ts --format=commander --limit=500

# Import via UI: Settings → Database Management → Select JSON File
```

See [Card Database Import Guide](CARD_DATABASE_IMPORT.md) for details.

---

## Technology Stack

| Category       | Technology                           |
| -------------- | ------------------------------------ |
| **Frontend**   | Next.js 15, React 19, TypeScript 5   |
| **UI**         | Shadcn/ui, Radix UI, Tailwind CSS    |
| **Backend**    | Tauri 2, Rust                        |
| **AI**         | Genkit, Gemini, Claude, OpenAI, Z.ai |
| **Database**   | IndexedDB (client-side)              |
| **Networking** | WebRTC (PeerJS)                      |
| **Testing**    | Jest, Playwright                     |
| **Build**      | Turbopack, Next.js Build             |

---

## License

Planar Nexus is released under the [MIT License](LICENSE).

```
MIT License

Copyright (c) 2024 Planar Nexus

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## Legal Notices

**WotC Fan Content Policy Disclaimer**: Planar Nexus is unofficial Fan Content permitted under the Fan Content Policy. Not approved/endorsed by Wizards. Portions of the materials used are property of Wizards of the Coast. ©Wizards of the Coast LLC.

**Trademark Notice**: Magic: The Gathering, Magic, MTG, and all related characters and elements are trademarks of Wizards of the Coast, LLC.

**Copyright Notice**: All card images, text, and game rules are property of Wizards of the Coast. This project uses the Scryfall API for card data but does not host any copyrighted materials.

---

## Support and Community

- **Bug Reports**: [GitHub Issues](https://github.com/anchapin/planar-nexus/issues)
- **Discussions**: [GitHub Discussions](https://github.com/anchapin/planar-nexus/discussions)
- **Documentation**: [Wiki](https://github.com/anchapin/planar-nexus/wiki)

---

**Version**: 1.0.0  
**Last Updated**: March 12, 2026
