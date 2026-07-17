# Planar Nexus User Guide

**Version**: v1.7+ (pre-v1.8)  
**Last Updated**: July 17, 2026

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
9. [Draft & Sealed (v1.4)](#9-draft--sealed-v14)
10. [Meta & Strategy AI (v1.5)](#10-meta--strategy-ai-v15)
11. [Conversational AI Coach (v1.7)](#11-conversational-ai-coach-v17)
12. [Standard Rotation & Ban List (v1.6)](#12-standard-rotation--ban-list-v16)

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

| Issue                         | Description                      | Solution                                            |
| ----------------------------- | -------------------------------- | --------------------------------------------------- |
| **Too few cards**             | Deck has fewer than minimum      | Add more cards (100 for Commander, 60 for Standard) |
| **Too many cards**            | Deck exceeds maximum             | Remove cards (100 max for Commander)                |
| **Illegal cards**             | Cards not legal in format        | Remove or replace with legal cards                  |
| **Color identity violation**  | Cards outside commander's colors | Remove cards with conflicting colors                |
| **Duplicate legendary cards** | More than one copy of legendary  | Reduce to 1 copy                                    |

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

| Shortcut | Action                       |
| -------- | ---------------------------- |
| `Ctrl+N` | New Deck                     |
| `Ctrl+S` | Save Deck                    |
| `Ctrl+O` | Open Deck                    |
| `Ctrl+F` | Search Cards                 |
| `Ctrl+I` | Import Decklist              |
| `Ctrl+E` | Export Deck                  |
| `Ctrl+,` | Open Settings                |
| `F1`     | Open Help                    |
| `F5`     | Refresh                      |
| `Esc`    | Close Dialog / Cancel Action |

### Deck Builder Shortcuts

| Shortcut     | Action                     |
| ------------ | -------------------------- |
| `+`          | Add Card to Deck           |
| `-`          | Remove Card from Deck      |
| `Shift++`    | Add Maximum Copies         |
| `Shift+-`    | Remove All Copies          |
| `Arrow Keys` | Navigate Cards             |
| `Enter`      | Add Focused Card / Confirm |

### Game Shortcuts

| Shortcut | Action               |
| -------- | -------------------- |
| `Space`  | End Turn             |
| `A`      | Attack with Selected |
| `B`      | Block with Selected  |
| `T`      | Target Selection     |
| `U`      | Untap Permanent      |
| `Ctrl+Z` | Undo Last Action     |

---

## 9. Draft & Sealed (v1.4)

> Shipped 2026-03-19 (Phases 14-17). Limited-format play: build a deck from a
> generated pool instead of your collection. Driven by the limited engine in
> [`src/lib/limited/`](../src/lib/limited) (`draft-generator.ts`,
> `sealed-generator.ts`, `pool-storage.ts`, `set-service.ts`,
> `limited-validator.ts`).

### 9.1 Draft

A draft sends three packs around the table; you pick one card per pass and
build a 40+ card deck from what you keep.

1. Navigate to **Draft** in the dashboard (route
   [`/draft`](../src/app/(app)/draft/page.tsx)).
2. **Choose a set** to draft from (served by `set-service.ts`, which reads the
   card data already imported via **Settings → Card Database**).
3. The draft generates three packs of 15 face-down cards via
   `generateDraftPacks` / `createDraftSession` in
   [`src/lib/limited/draft-generator.ts`](../src/lib/limited/draft-generator.ts).
4. **Pick a card** each time a pack is in front of you. The pack then rotates
   to the next seat (AI bots fill the other seats) via `passPack`.

#### Pick Timer

Each pick has a countdown. The timer ring transitions through three colour
states so you can feel the pressure without watching the clock:

| Time remaining | Ring colour | Behaviour                                |
| -------------- | ----------- | ---------------------------------------- |
| > 50%          | Green       | Normal — take your time                  |
| 20% – 50%      | Yellow      | Speed up; decide soon                    |
| < 20%          | Red         | Final warning; auto-pick fires at zero   |

When the timer hits zero the engine **auto-picks** the highest-rated card still
in the pack so the draft never stalls.

5. After all three packs are empty, the session completes (see
   [`/draft/complete`](../src/app/(app)/draft/complete/page.tsx)) and your pool
   is persisted to IndexedDB (`pool-storage.ts`) for deck building.

### 9.2 Sealed

Sealed gives you one fixed pool to build from — no passing.

1. Navigate to **Sealed** (route
   [`/sealed`](../src/app/(app)/sealed/page.tsx)).
2. Pick a set; `sealed-generator.ts` produces a pool (typically 6 packs worth).
3. The pool gets a unique session ID and **persists across page refresh**, so
   you can leave and come back to the same sealed pool.

### 9.3 Building the Limited Deck

Open **Limited Deck Builder** ([`/limited-deck-builder`](../src/app/(app)/limited-deck-builder/page.tsx))
to assemble your pool into a legal deck:

- Minimum 40 cards (enforced by `validateLimitedDeck` in
  [`src/lib/limited/limited-validator.ts`](../src/lib/limited/limited-validator.ts)).
- You may add any number of basic lands (supplied separately from your pool).
- Cards can only come from your pool — the validator rejects cards you didn't
  open via `canAddCardToDeck` / `isPoolCard`.

### 9.4 Draft Assistant

Stuck on a pick? **Draft Assistant** ([`/draft-assistant`](../src/app/(app)/draft-assistant/page.tsx))
reads the current pack and suggests the strongest pick based on synergy with
the cards you've already taken. It runs through the same AI provider stack as
the coach (see [Section 3](#3-ai-coach)); no provider key is required for the
heuristic baseline.

### 9.5 Set Browser

**Set Browser** ([`/set-browser`](../src/app/(app)/set-browser/page.tsx)) lists
the sets available for drafting and sealed, showing card counts and the format
each set feeds. Use it to decide which set to draft before starting a session.

---

## 10. Meta & Strategy AI (v1.5)

> Shipped 2026-03-19 (Phases 18-20). Quantitative analysis of *constructed*
> decks: what archetype a list is, how it matches up, and how to sideboard.

These four routes share the same AI provider stack as the coach (see
[Section 3](#3-ai-coach) and [docs/API.md](./API.md)). The heuristic baseline
runs without an API key; configuring a provider sharpens the recommendations.

### 10.1 Archetype Detection

Every deck you open is auto-classified by
[`detectArchetype`](../src/ai/archetype-detector.ts) against the signature
library in [`src/ai/archetype-signatures.ts`](../src/ai/archetype-signatures.ts).
The detected archetype powers the badge shown across the meta views and feeds
the recommendations below.

- **Primary + secondary archetype** with a confidence score (70%+ is reliable).
- **Axis classification** (`classifyArchetypeAxis`) positions the deck on the
  aggro↔control and proactive↔reactive axes.
- **Deck stats** (`getDeckStats`) — curve, role mix, colour distribution — are
  surfaced wherever an archetype badge appears.

If the detector mislabels a brew, refine the list and re-open the deck; the
classification recomputes from the current cards.

### 10.2 Matchup Guides

**Matchup** ([`/matchup`](../src/app/(app)/matchup/page.tsx)) takes two decks
and produces a head-to-head breakdown:

- **Expected win rate** for the chosen decks and format.
- **Key cards** on each side — the threats the opponent must answer and vice
  versa.
- **Turning points** — the decisions and permanents that most swing the game.

Use it before a league match or to sanity-check a sideboard plan against the
field you expect to face.

### 10.3 Meta Overview

**Meta** ([`/meta`](../src/app/(app)/meta/page.tsx)) shows the detected
archetypes across your decks plus a health score for each, so you can see at a
glance which archetypes are over- or under-represented in your testing pool.

- **Health score** summarises curve, land count, and interaction density into a
  single 0–100 rating; decks below ~60 usually need work.
- **Trends** track how a deck's score moves as you edit it, so you can tell
  whether a change helped or hurt.

### 10.4 Sideboard Plans

**Sideboards** ([`/sideboards`](../src/app/(app)/sideboards/page.tsx))
generates a 15-card sideboard plan for a deck against a target field, using the
anti-meta engine in
[`src/lib/anti-meta.ts`](../src/lib/anti-meta.ts)
(`getCounterRecommendations`, `getSideboardRecommendations`,
`getManaBaseRecommendations`). Each suggestion explains which opposing threat
it answers, so you can cut cards you don't own and still keep the plan coherent.

### 10.5 Strategy Recommendations

**Strategy** ([`/strategy`](../src/app/(app)/strategy/page.tsx)) ties the
pieces together: mulligan guidance, pacing notes, and anti-meta tech cards to
consider for your local field. Visual styling follows the tokens in
[`docs/design-tokens.md`](./design-tokens.md).

### 10.6 Typical Workflow

A common session moves across the four views in order:

1. Open a deck on **Meta** to read its archetype and health score.
2. Switch to **Matchup** against your expected opponent to find the losing
   lines.
3. Take those lines to **Sideboards** to generate the 15-card plan.
4. Finish on **Strategy** for mulligan and pacing notes tuned to the matchup.

---

## 11. Conversational AI Coach (v1.7)

> Shipped 2026-03-20 (Phases 27-30). A streaming chat coach you can ask
> follow-up questions of, mounted next to the one-shot report on the deck-coach
> page.

### 11.1 Opening the Chat

1. Open a deck in **AI Coach** as usual (see [Section 3](#3-ai-coach)).
2. The page now shows a **chat panel** beside the structured report
   ([`DeckCoachChatPanel`](../src/components/ai-coach/chat-panel.tsx), mounted
   on [`/deck-coach`](../src/app/(app)/deck-coach/page.tsx)).
3. Type a question and press **Enter** to send.

### 11.2 What You Can Ask

The coach classifies each turn by intent (implemented in
`src/ai/coach-intent.ts`) and answers in the context of the open deck. Typical
asks:

- "What's my weakest card?"
- "How do I beat Mono-Red?"
- "Should I cut the third copy of X?"
- "Build me a sideboard plan vs. control."

### 11.3 Streaming Responses

Answers stream token-by-token over Server-Sent Events from
`POST /api/chat/coach` (see [docs/API.md](./API.md)), so text appears as it is
generated. You can **Cancel** an in-flight answer mid-stream; the server stops
generating within one chunk.

### 11.4 Reliability Safeguards

- **Provider failover**: if the primary AI provider errors before any token is
  delivered, the route transparently retries the next provider in the failover
  chain.
- **Prompt-injection guardrails**: every user message is sanitized, and the
  system prompt is always rebuilt server-side — you cannot override it from the
  chat box.
- **Context pruning**: long sessions are pruned against a token budget so the
  conversation never exceeds the model's context window; your most recent turn
  is always retained intact.

### 11.5 Persistent Conversation History

Conversations are saved per-deck in IndexedDB (store `coach-conversations`,
managed by [`src/lib/coach-conversation-storage.ts`](../src/lib/coach-conversation-storage.ts))
so they survive page refresh and app restart:

- The most recent conversation for a deck reopens automatically.
- You can **export** conversations for a deck (or all decks) to JSON and
  **import** them back, useful for moving a coaching history between machines.
- Old conversations are pruned automatically (default cap: 50 per deck).

### 11.6 No-API-Key Mode

If no AI provider key is configured, the heuristic coach from
[Section 3](#3-ai-coach) still produces the structured report; the
conversational panel waits until a key is added in **Settings → AI**.

---

## 12. Standard Rotation & Ban List (v1.6)

> Shipped 2026-03-19 (QA/QC milestone, Phases 21-26). The in-app "Standard"
> format now tracks set rotation, not just the banned list.

### 12.1 How Rotation Works

Standard legality is computed from a canonical rotation schedule in
[`src/lib/game-rules.ts`](../src/lib/game-rules.ts):

- `STANDARD_ROTATION_SCHEDULE` — the list of sets, their release dates, and the
  dates they rotate out of Standard.
- `getStandardLegalSets(referenceDate?)` — returns the set codes legal in
  Standard as of a given date (defaults to today).

When you build a Standard deck, the deck builder flags any card whose printing
has rotated out, even if the card name itself isn't on a ban list.

### 12.2 Reading the Schedule

The full, human-readable schedule — including the next rotation date and the
sets leaving — lives in [`docs/standard-rotation.md`](./standard-rotation.md).
Check there before a big event to confirm your list is still legal. The doc is
generated from the same `STANDARD_ROTATION_SCHEDULE` constant the validator
reads, so it always matches what the app enforces.

### 12.3 Spot-Checking a Card

When you add a card to a Standard deck, the status panel reports one of three
outcomes:

| Marker | Meaning                                                              |
| ------ | -------------------------------------------------------------------- |
| ✓ Legal | Card's most recent Standard-legal printing is from a current set     |
| ⚠ Rotated | Card's sets have all rotated out — replace it with a legal equivalent |
| ✗ Banned | Card is on the format ban list regardless of set                    |

To find the exact set that aged a card out, open the card detail view; the
**Format Legality** section lists each printing and whether that set is still
in Standard as of today (computed via `getStandardLegalSets`).

### 12.4 Ban List

Banned cards (independent of rotation) are still enforced by the format
validator used in [Section 2.3](#23-deck-validation). A card that is legal by
rotation but banned in the format will show a **✗ Illegal** marker with the
reason in the deck status panel. The ban list is maintained separately from the
rotation schedule, so a card can return to legality on a future un-ban even if
its original set has rotated.

### 12.5 Worked Example

Suppose Standard rotates on the first Friday of September, removing set `DMU`:

1. Before rotation, a deck running four `DMU` cards shows all **✓ Legal**.
2. On rotation day, the same deck suddenly shows four **⚠ Rotated** markers
   without you touching it — `getStandardLegalSets(now)` now excludes `DMU`.
3. Replace each rotated card (the detail view suggests Standard-legal
   equivalents), and the markers clear. Any card that is *also* banned stays
   **✗ Banned** even after you swap the printing.

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

| Issue                  | Quick Fix                                   |
| ---------------------- | ------------------------------------------- |
| Cards not loading      | Check database status in Settings           |
| AI not responding      | Verify API key in Settings → AI             |
| Can't join multiplayer | Check internet connection, verify game code |
| Deck validation fails  | Review format rules, check card legality    |
| App runs slowly        | Clear image cache, restart app              |

For detailed troubleshooting, see [Troubleshooting Guide](TROUBLESHOOTING.md).

---

## Support

- **Documentation**: [GitHub Wiki](https://github.com/anchapin/planar-nexus/wiki)
- **Bug Reports**: [GitHub Issues](https://github.com/anchapin/planar-nexus/issues)
- **Community**: [Discussions](https://github.com/anchapin/planar-nexus/discussions)
