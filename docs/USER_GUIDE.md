# Planar Nexus User Guide

**Version**: 1.0.0  
**Last Updated**: March 12, 2026

---

## Table of Contents

1. [Getting Started](#1-getting-started)
2. [Deck Building](#2-deck-building)
3. [AI Coach](#3-ai-coach)
4. [AI Opponent](#4-ai-opponent)
5. [Multiplayer](#5-multiplayer)
6. [Import/Export](#6-importexport)
7. [Settings](#7-settings)
8. [Keyboard Shortcuts](#8-keyboard-shortcuts)

---

## 1. Getting Started

### 1.1 Installation

#### Download Pre-built Installer

1. Visit [GitHub Releases](https://github.com/anchapin/planar-nexus/releases)
2. Download the installer for your platform:
   - **Windows**: `Planar-Nexus-setup.exe`
   - **macOS**: `Planar-Nexus.dmg`
   - **Linux**: `planar-nexus_1.0.0_amd64.deb` or `.AppImage`

3. Run the installer following platform-specific instructions:

**Windows**:
- Double-click the `.exe` file
- If SmartScreen warns, click "More info" → "Run anyway"
- Follow installation prompts

**macOS**:
- Open the `.dmg` file
- Drag Planar Nexus to Applications folder
- If blocked, right-click → Open → Open

**Linux**:
```bash
# Debian/Ubuntu
sudo dpkg -i planar-nexus_1.0.0_amd64.deb

# AppImage (any distro)
chmod +x Planar-Nexus.AppImage
./Planar-Nexus.AppImage
```

### 1.2 First Launch

1. **Launch the application** from your Start Menu, Applications folder, or terminal

2. **Card Database Initialization** (first launch only):
   - The app will initialize with an empty card database
   - To import cards, go to **Settings → Database Management**
   - See [Card Database Import](#73-card-database) for details

3. **Navigate to Deck Builder** to start building your first deck

### 1.3 Interface Overview

```
┌─────────────────────────────────────────────────────────────┐
│  Planar Nexus  [Dashboard] [Deck Builder] [Coach] [Play]    │
│─────────────────────────────────────────────────────────────│
│                                                              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐          │
│  │             │  │             │  │             │          │
│  │  Deck       │  │  AI         │  │  Single     │          │
│  │  Builder    │  │  Coach      │  │  Player     │          │
│  │             │  │             │  │             │          │
│  └─────────────┘  └─────────────┘  └─────────────┘          │
│                                                              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐          │
│  │             │  │             │  │             │          │
│  │  Multi-     │  │  Settings   │  │  Help       │          │
│  │  player     │  │             │  │             │          │
│  │             │  │             │  │             │          │
│  └─────────────┘  └─────────────┘  └─────────────┘          │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

**Main Navigation**:
- **Dashboard**: Overview and quick access to features
- **Deck Builder**: Create and manage decks
- **AI Coach**: Get deck analysis and recommendations
- **Single Player**: Play against AI opponents
- **Multiplayer**: Play with friends online
- **Settings**: Configure application preferences

---

## 2. Deck Building

### 2.1 Creating a New Deck

1. Click **"Deck Builder"** in the navigation bar

2. Click **"New Deck"** button (or press `Ctrl+N`)

3. Enter deck details:
   - **Deck Name**: Give your deck a unique name
   - **Format**: Select Commander, Standard, Modern, Legacy, or Vintage
   - **Description** (optional): Add notes about your deck strategy

4. Click **"Create"** to start building

### 2.2 Adding Cards

#### Search for Cards

1. Use the **search bar** at the top of the card browser

2. **Search by name**:
   - Type any part of the card name
   - Fuzzy matching handles typos (e.g., "Sol Rng" finds "Sol Ring")

3. **Filter results**:
   - **Color**: Filter by color identity (White, Blue, Black, Red, Green, Colorless)
   - **Type**: Filter by card type (Creature, Instant, Sorcery, etc.)
   - **CMC**: Filter by converted mana cost range
   - **Format Legality**: Show only cards legal in your selected format

4. Click a card to view details:
   - Card text and abilities
   - Format legality
   - Mana cost and stats

#### Add Cards to Deck

1. **Click the "+" button** on a card to add one copy

2. **Shift+Click** to add maximum allowed copies:
   - Standard: Up to 4 copies (except basic lands)
   - Commander: Up to 1 copy (except basic lands)

3. **Remove cards**:
   - Click the "-" button to remove one copy
   - Right-click → "Remove All" to remove all copies

### 2.3 Deck Validation

The deck validator runs automatically as you build:

#### Real-time Feedback

**Deck Status Panel** shows:
- **Card Count**: Current/Required (e.g., "98/100" for Commander)
- **Format Compliance**: ✓ Legal or ✗ Illegal
- **Warnings**: Issues that need attention

#### Common Validation Issues

| Issue | Description | Solution |
|-------|-------------|----------|
| **Too few cards** | Deck has fewer than minimum | Add more cards (100 for Commander, 60 for Standard) |
| **Too many cards** | Deck exceeds maximum | Remove cards (100 max for Commander) |
| **Illegal cards** | Cards not legal in format | Remove or replace with legal cards |
| **Color identity violation** | Cards outside commander's colors | Remove cards with conflicting colors |
| **Duplicate legendary cards** | More than one copy of legendary | Reduce to 1 copy |

### 2.4 Deck Statistics

View deck analytics in the **Statistics Panel**:

#### Mana Curve
- Bar chart showing card distribution by CMC
- Ideal curves vary by archetype (Aggro: low CMC, Control: higher CMC)

#### Color Distribution
- Pie chart showing color breakdown
- Helps identify color balance

#### Card Type Distribution
- Breakdown by creature, spell, land, etc.
- Ensure adequate land count (typically 35-40 for Commander)

### 2.5 Saving and Managing Decks

#### Auto-Save
- Decks auto-save on every change
- No manual save required during editing

#### Manual Save
- Press `Ctrl+S` to force save
- Click **"Save Deck"** button

#### Organize Decks

**Deck Library** shows all saved decks:
- **Search**: Filter by deck name
- **Sort**: By name, date modified, or format
- **Folders**: Create folders to organize decks (optional)

#### Delete a Deck
1. Find deck in library
2. Click the **⋮** menu
3. Select **"Delete"**
4. Confirm deletion

---

## 3. AI Coach

### 3.1 Getting Coach Feedback

1. Navigate to **"AI Coach"** in the navigation bar

2. **Select a deck** to analyze from your deck library

3. **Choose AI provider** (if multiple configured):
   - Gemini (default)
   - Claude
   - OpenAI
   - Z.ai

4. Click **"Analyze Deck"**

5. **Wait for analysis** (typically 5-10 seconds)

### 3.2 Understanding the Report

The AI Coach report includes several sections:

#### Archetype Badge
```
┌─────────────────────────┐
│  🔥 BURN                │
│  Confidence: 85%        │
│  Secondary: Aggro       │
└─────────────────────────┘
```

- **Primary Archetype**: Main deck archetype detected
- **Confidence**: How certain the AI is (70%+ is reliable)
- **Secondary**: Alternative archetype classification

**Detected Archetypes** (18 total):
- **Aggro**: Burn, Zoo, Sligh
- **Control**: Draw-Go, Stax, Prison
- **Midrange**: Good Stuff, Rock, Value
- **Combo**: Storm, Reanimator, Infinite
- **Tribal**: Elves, Goblins, Zombies, Dragons
- **Special**: Lands, Superfriends

#### Synergy List
```
Synergies Found (4):
┌────────────────────────────────────────────┐
│ ✨ Flying + Deathtouch (Score: 0.92)       │
│   Cards: [Specter of the Fens, etc.]       │
│   These creatures are hard to block        │
├────────────────────────────────────────────┤
│ ⚡ Lightning Bolt + Damage Boost (0.85)    │
│   Cards: [Lightning Bolt, Mutagenic Growth]│
│   Direct damage becomes lethal             │
└────────────────────────────────────────────┘
```

- **Synergy Name**: Pattern identified
- **Score**: Strength of synergy (0.0-1.0)
- **Cards**: Cards that create the synergy
- **Description**: Why this synergy matters

#### Missing Synergies
```
Missing Synergies (2):
┌────────────────────────────────────────────┐
│ ⚠️ HIGH IMPACT: Sacrifice Outlet          │
│   You have sacrifice targets but no outlet │
│   Consider: [Viscera Seer, Carrion Feeder]│
├────────────────────────────────────────────┤
│ ⚡ MEDIUM IMPACT: Card Draw               │
│   Deck may run out of steam                │
│   Consider: [Brainstorm, Ponder]          │
└────────────────────────────────────────────┘
```

- **Impact Level**: How much the synergy would help
  - 🔴 HIGH: Critical gap in strategy
  - 🟡 MEDIUM: Would improve consistency
  - 🟢 LOW: Nice to have
- **Suggestion**: Specific cards to consider

#### Key Cards
```
Key Cards (5):
┌────────────────────────────────────────────┐
│ 🌟 Lightning Bolt                          │
│   Primary damage source, essential win con │
├────────────────────────────────────────────┤
│ 🌟 Goblin Guide                             │
│   Early pressure, forces opponent to react │
└────────────────────────────────────────────┘
```

- **Card Name**: Important cards in your deck
- **Role**: Why this card matters to your strategy

#### Improvement Suggestions
```
Suggestions:
• Consider adding 2-3 more burn spells for consistency
• Sideboard options against control: [Spell Pierce, etc.]
• Mana base could include [Mountain] for color fixing
```

### 3.3 Exporting Reports

#### Export as Text
1. Click **"Export"** button in report header
2. Select **"Download as Text"**
3. Save `.txt` file to your computer

#### Export as PDF
1. Click **"Export"** button
2. Select **"Print to PDF"**
3. Use browser's print dialog to save as PDF

#### Share Report
- Copy report text to clipboard
- Share via email, Discord, or forum posts
- Include decklist for context

---

## 4. AI Opponent

### 4.1 Starting a Game

1. Navigate to **"Single Player"**

2. **Select Your Deck**:
   - Choose from your deck library
   - Deck must be valid for selected format

3. **Configure AI Opponent**:

   **Difficulty Level**:
   | Level | Win Rate | Description |
   |-------|----------|-------------|
   | Easy | 80% | Beginner-friendly, makes mistakes |
   | Medium | 60% | Balanced challenge |
   | Hard | 40% | Challenging for experienced players |
   | Expert | 25% | Near-perfect play |

   **AI Theme** (optional):
   - Aggro: Aggressive, fast attacks
   - Control: Defensive, counterspells
   - Combo: Seeks win conditions
   - Random: Unpredictable

4. Click **"Start Game"**

### 4.2 Playing a Game

#### Game Interface
```
┌─────────────────────────────────────────────────────────────┐
│  Opponent (Life: 20)                                        │
│  [Hand: 7 cards]                                            │
│  ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐   │
│  │  ?  │ │  ?  │ │  ?  │ │  ?  │ │  ?  │ │  ?  │ │  ?  │   │
│  └─────┘ └─────┘ └─────┘ └─────┘ └─────┘ └─────┘ └─────┘   │
│                                                             │
│                    [Battlefield]                            │
│  ┌─────┐ ┌─────┐              ┌─────┐ ┌─────┐              │
│  │Creature│ │Creature│        │Creature│ │Creature│        │
│  └─────┘ └─────┘              └─────┘ └─────┘              │
│                                                             │
│  Your Life: 20  |  Turn: 3  |  Phase: Main                  │
│                                                             │
│  [Your Hand]                                                │
│  ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐   │
│  │Card │ │Card │ │Card │ │Card │ │Card │ │Card │ │Card │   │
│  └─────┘ └─────┘ └─────┘ └─────┘ └─────┘ └─────┘ └─────┘   │
│                                                             │
│  [Play] [Combat] [End Turn]                                 │
└─────────────────────────────────────────────────────────────┘
```

#### Turn Structure

1. **Beginning Phase**:
   - Untap all your permanents
   - Draw a card (except first turn)
   - Upkeep triggers resolve

2. **Main Phase**:
   - Play lands (one per turn)
   - Cast spells
   - Activate abilities

3. **Combat Phase**:
   - **Declare Attackers**: Choose which creatures attack
   - **Declare Blockers**: Opponent chooses blockers
   - **Combat Damage**: Damage is dealt
   - **End of Combat**: Combat ends

4. **End Phase**:
   - End step triggers
   - Discard to maximum hand size (usually 7)
   - Turn passes to opponent

#### Priority System

- Players receive **priority** to cast spells or activate abilities
- Priority passes between players
- Stack resolves last-in-first-out (LIFO)
- Click **"Hold Priority"** to cast multiple spells before passing

### 4.3 Difficulty Levels Explained

#### Easy
- **Behavior**: Makes obvious mistakes, inefficient plays
- **Best For**: Learning game mechanics, testing combos
- **Tips**: Focus on fundamentals, practice sequencing

#### Medium
- **Behavior**: Reasonable plays, occasional blunders
- **Best For**: Casual play, deck testing
- **Tips**: Respect their threats, plan ahead

#### Hard
- **Behavior**: Strong plays, rare mistakes, punishes errors
- **Best For**: Experienced players, serious testing
- **Tips**: Play around their outs, maximize value

#### Expert
- **Behavior**: Near-optimal play, deep planning
- **Best For**: Challenge, high-level testing
- **Tips**: Perfect play required, no room for error

### 4.4 Game History

#### View Past Games
1. After game ends, click **"View History"**
2. See list of recent games with:
   - Opponent and difficulty
   - Result (Win/Loss)
   - Turn count
   - Date played

#### Replay a Game
1. Select a game from history
2. Click **"Replay"**
3. Watch game unfold turn by turn
4. Use controls to pause, rewind, fast-forward

---

## 5. Multiplayer

### 5.1 Creating a Game

1. Navigate to **"Multiplayer"**

2. Click **"Host Game"**

3. **Configure Game Settings**:
   - **Format**: Commander, Standard, etc.
   - **Max Players**: 2 or 4
   - **Team Mode**: Free-for-all or 2v2
   - **Spectators**: Allow or disallow

4. Click **"Create"**

5. **Share Game Code** with friends:
   - Code displayed prominently (e.g., `ABC123`)
   - Share via Discord, chat, etc.

### 5.2 Joining a Game

1. Click **"Join Game"**

2. **Enter Game Code** provided by host

3. **Select Your Deck** (must be valid for format)

4. Click **"Join"**

5. **Wait for Host** to start the game

### 5.3 Playing Multiplayer

#### Team Mode (2v2)
- You and your partner share turns
- Attack either opponent
- Win by eliminating both opponents

#### Free-for-All (4-player)
- Each player takes individual turns
- Attack any opponent
- Last player standing wins

#### Spectator Mode
- Watch games without playing
- See all hands and board states
- Chat with other spectators

---

## 6. Import/Export

### 6.1 Importing Decklists

#### From Clipboard
1. Copy decklist from any source
2. Click **"Import"** → **"From Clipboard"**
3. Paste decklist
4. Click **"Parse"**
5. Review and confirm

**Supported Formats**:
```
# Standard format
4 Lightning Bolt
4 Goblin Guide
24 Mountain

# With set codes
4 LTB [Modern]
4 GDB [Modern]

# Full details
4x Lightning Bolt (M21) #234
```

#### From File
1. Click **"Import"** → **"From File"**
2. Select `.txt` or `.json` file
3. Decklist is parsed and loaded

#### From URL
1. Click **"Import"** → **"From URL"**
2. Paste URL (e.g., MTGGoldfish, TappedOut)
3. Decklist is fetched and parsed

### 6.2 Exporting Decks

#### Export as Text
1. Open deck in Deck Builder
2. Click **"Export"** → **"Text"**
3. Copy or download decklist

#### Export as JSON
1. Click **"Export"** → **"JSON"**
2. Download `.json` file with full deck data
3. Includes metadata and notes

#### Export as Share Link
1. Click **"Export"** → **"Share Link"**
2. Copy generated URL
3. Share with others (they can import)

---

## 7. Settings

### 7.1 General Settings

**Appearance**:
- **Theme**: Light or Dark mode
- **Card Size**: Small, Medium, Large
- **Animations**: Enable/disable visual effects

**Behavior**:
- **Auto-Save**: Enable/disable automatic deck saving
- **Confirm Actions**: Require confirmation for destructive actions
- **Sound Effects**: Enable/disable game sounds

### 7.2 AI Settings

**API Key Configuration**:
1. Navigate to **Settings → AI**
2. Select AI provider
3. Enter your API key
4. Click **"Validate"** to test connection
5. Click **"Save"**

**Supported Providers**:
- **Gemini**: Google AI (free tier available)
- **Claude**: Anthropic (paid)
- **OpenAI**: GPT models (paid)
- **Z.ai**: GLM models (paid)

**Usage Tracking**:
- View API usage statistics
- Set spending limits (optional)
- Clear usage history

### 7.3 Card Database

**Database Status**:
- View total card count
- Check database health
- Last import date

**Import Cards**:
1. Click **"Import Cards"**
2. Select JSON file from card fetch script
3. Wait for import to complete

**Clear Database**:
- ⚠️ **Warning**: This cannot be undone
- Click **"Clear Database"** in Danger Zone
- Confirm action

**Clear Image Cache**:
- Removes cached card images
- Frees up storage space
- Images re-download as needed

### 7.4 Network Settings

**Multiplayer**:
- **Username**: Display name for multiplayer
- **Status**: Online/Away/Do Not Disturb
- **Friends**: Manage friend list

**Privacy**:
- **Show Online Status**: Visible to friends
- **Allow Game Invites**: Receive invitations
- **Show Match History**: Public or private

---

## 8. Keyboard Shortcuts

### Global Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+N` | New Deck |
| `Ctrl+S` | Save Deck |
| `Ctrl+O` | Open Deck |
| `Ctrl+F` | Search Cards |
| `Ctrl+I` | Import Decklist |
| `Ctrl+E` | Export Deck |
| `Ctrl+,` | Open Settings |
| `F1` | Open Help |
| `F5` | Refresh |
| `Esc` | Close Dialog / Cancel Action |

### Deck Builder Shortcuts

| Shortcut | Action |
|----------|--------|
| `+` | Add Card to Deck |
| `-` | Remove Card from Deck |
| `Shift++` | Add Maximum Copies |
| `Shift+-` | Remove All Copies |
| `Arrow Keys` | Navigate Cards |
| `Enter` | View Card Details |

### Game Shortcuts

| Shortcut | Action |
|----------|--------|
| `Space` | End Turn |
| `A` | Attack with Selected |
| `B` | Block with Selected |
| `T` | Target Selection |
| `U` | Untap Permanent |
| `Ctrl+Z` | Undo Last Action |

---

## Appendix A: Format Rules

### Commander
- **Deck Size**: Exactly 100 cards (including commander)
- **Card Limits**: 1 copy per card (except basic lands)
- **Color Identity**: Cards must match commander's colors
- **Starting Life**: 40
- **Commander Damage**: 21 damage from one commander is lethal

### Standard
- **Deck Size**: Minimum 60 cards
- **Card Limits**: 4 copies per card (except basic lands)
- **Sideboard**: Optional, exactly 15 cards
- **Starting Life**: 20

### Modern
- **Deck Size**: Minimum 60 cards
- **Card Limits**: 4 copies per card (except basic lands)
- **Sideboard**: Optional, exactly 15 cards
- **Starting Life**: 20
- **Banned List**: Check current Modern banned list

---

## Appendix B: Troubleshooting Quick Reference

| Issue | Quick Fix |
|-------|-----------|
| Cards not loading | Check database status in Settings |
| AI not responding | Verify API key in Settings → AI |
| Can't join multiplayer | Check internet connection, verify game code |
| Deck validation fails | Review format rules, check card legality |
| App runs slowly | Clear image cache, restart app |

For detailed troubleshooting, see [Troubleshooting Guide](TROUBLESHOOTING.md).

---

## Support

- **Documentation**: [GitHub Wiki](https://github.com/anchapin/planar-nexus/wiki)
- **Bug Reports**: [GitHub Issues](https://github.com/anchapin/planar-nexus/issues)
- **Community**: [Discussions](https://github.com/anchapin/planar-nexus/discussions)
