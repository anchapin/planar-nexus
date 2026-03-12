# Planar Nexus Troubleshooting Guide

**Version**: 1.0.0  
**Last Updated**: March 12, 2026

---

## Table of Contents

1. [Installation Issues](#1-installation-issues)
2. [Card Database Issues](#2-card-database-issues)
3. [AI Features Issues](#3-ai-features-issues)
4. [Performance Issues](#4-performance-issues)
5. [Multiplayer Issues](#5-multiplayer-issues)
6. [Build Issues](#6-build-issues)
7. [Common Error Messages](#7-common-error-messages)
8. [Getting Help](#8-getting-help)

---

## 1. Installation Issues

### 1.1 Windows Installation

#### "SmartScreen prevented installation"

**Cause**: App not yet recognized by Windows SmartScreen (common for new applications)

**Solution**:
1. When SmartScreen appears, click **"More info"**
2. Click **"Run anyway"**
3. Application will install normally

**Long-term fix**: Code signing certificate will resolve this in future releases

---

#### "This app can't run on your PC"

**Cause**: Architecture mismatch (trying to run 64-bit app on 32-bit Windows)

**Solution**:
1. Check your Windows version: Settings → System → About
2. If you have 32-bit Windows, you'll need to use the web version
3. For 64-bit Windows, re-download the installer

---

#### Installation fails with error code 0x80070005

**Cause**: Permission issues or antivirus interference

**Solution**:
1. Right-click installer → **"Run as administrator"**
2. Temporarily disable antivirus
3. Add Planar Nexus to antivirus exclusion list
4. Retry installation

---

#### Shortcut not created after installation

**Cause**: Installer permission issue

**Solution**:
1. Navigate to installation folder (default: `C:\Program Files\Planar Nexus`)
2. Find `Planar Nexus.exe`
3. Right-click → **Send to** → **Desktop (create shortcut)**

---

### 1.2 macOS Installation

#### "App can't be opened" or "Damaged app"

**Cause**: Gatekeeper blocking unsigned application

**Solution 1** (Recommended):
1. Right-click (or Control-click) the app
2. Select **"Open"** from context menu
3. Click **"Open"** in the dialog

**Solution 2** (Command line):
```bash
# Remove quarantine attribute
xattr -d com.apple.quarantine /Applications/Planar\ Nexus.app

# Or for entire folder
xattr -cr /Applications/Planar\ Nexus.app
```

---

#### App crashes on launch (macOS)

**Cause**: Missing dependencies or corrupted installation

**Solution**:
1. Delete the app from Applications folder
2. Re-download the DMG file
3. Reinstall the application
4. If issue persists, check Console.app for crash logs

---

#### "Planar Nexus.app is damaged and can't be opened"

**Cause**: Download was corrupted or incomplete

**Solution**:
1. Delete the downloaded DMG file
2. Clear browser cache
3. Re-download the DMG
4. Verify file size matches GitHub release
5. Reinstall

---

### 1.3 Linux Installation

#### ".deb installation fails"

**Cause**: Missing dependencies

**Solution**:
```bash
# Install required dependencies
sudo apt-get update
sudo apt-get install -y libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev

# Retry installation
sudo dpkg -i planar-nexus_1.0.0_amd64.deb

# Fix any broken dependencies
sudo apt-get install -f
```

---

#### AppImage won't run

**Cause**: Missing FUSE or execution permissions

**Solution**:
```bash
# Make executable
chmod +x Planar-Nexus.AppImage

# Install FUSE if needed (Ubuntu/Debian)
sudo apt-get install libfuse2

# Run the AppImage
./Planar-Nexus.AppImage
```

---

#### "No such file or directory" when running AppImage

**Cause**: Missing system libraries

**Solution**:
```bash
# Install common dependencies
sudo apt-get install -y libgtk-3-0 libnotify4 libnss3 libxss1 libxtst6 xdg-utils libatspi2.0-0

# For Fedora
sudo dnf install gtk3 libnotify nss libXScrnSaver libXtst at-spi2-atk
```

---

### 1.4 Web Version Issues

#### Page doesn't load

**Cause**: Browser compatibility or network issue

**Solution**:
1. Try a different browser (Chrome, Firefox, Safari, Edge)
2. Clear browser cache and cookies
3. Check internet connection
4. Disable browser extensions temporarily
5. Check browser console for errors (F12)

---

#### "This browser is not supported"

**Cause**: Using an outdated browser

**Solution**:
- Update your browser to the latest version
- Minimum supported versions:
  - Chrome 90+
  - Firefox 88+
  - Safari 14+
  - Edge 90+

---

## 2. Card Database Issues

### 2.1 Database Initialization

#### "Card database failed to load"

**Cause**: IndexedDB corruption or browser storage issue

**Solution**:
1. Open DevTools (F12)
2. Go to **Application** tab → **IndexedDB**
3. Delete the `planar-nexus` database
4. Refresh the page
5. Database will reinitialize

**Alternative**:
```javascript
// Run in browser console
indexedDB.deleteDatabase('PlanarNexusCardDB');
location.reload();
```

---

#### "Database is empty" after import

**Cause**: Import didn't complete or JSON file is invalid

**Solution**:
1. Check that your JSON file is valid:
   ```bash
   # Validate JSON
   node -e "JSON.parse(require('fs').readFileSync('my-cards.json'))"
   ```
2. Ensure JSON is an array of card objects
3. Re-import the file
4. Check browser console for errors during import

---

#### Import takes forever or hangs

**Cause**: Large file or browser performance issue

**Solution**:
1. Wait at least 2-3 minutes for large imports (1000+ cards)
2. Don't refresh the page during import
3. Try importing a smaller file first (500 cards)
4. Close other browser tabs to free memory
5. Try a different browser

---

### 2.2 Card Search

#### "No cards found" when searching

**Cause**: Database is empty or search index not built

**Solution**:
1. Check database status: Settings → Database Management
2. If card count is 0, import cards
3. Wait for index to build after import (few seconds)
4. Refresh the page

---

#### Search returns incorrect results

**Cause**: Fuzzy search threshold too low or index issue

**Solution**:
1. Try more specific search terms
2. Use exact card name for precise results
3. Clear and rebuild database if issue persists

---

#### Card images not loading

**Cause**: Image cache corruption or network issue

**Solution**:
1. Go to Settings → Database Management
2. Click **"Clear Image Cache"**
3. Refresh the page
4. Images will reload as needed

---

### 2.3 Deck Validation

#### "Card not found in database"

**Cause**: Card not imported or name mismatch

**Solution**:
1. Search for the card by name to verify it exists
2. If not found, import more cards
3. Check for typos in card name
4. Some cards may have different printings with slight name variations

---

#### "Deck validation fails" for legal deck

**Cause**: Format rules not applied correctly

**Solution**:
1. Verify you selected the correct format
2. Check commander color identity matches deck
3. Ensure card count matches format (100 for Commander, 60 for Standard)
4. Review format-specific banned list

---

## 3. AI Features Issues

### 3.1 AI Coach

#### "AI coach not responding" or timeout

**Cause**: API key not configured, rate limit, or network issue

**Solution**:
1. **Check API key configuration**:
   - Go to Settings → AI
   - Verify API key is entered and saved
   - Click "Validate" to test connection

2. **Check rate limits**:
   - Free tier: 10 requests/minute
   - Wait 60 seconds and try again

3. **Check network**:
   - Verify internet connection
   - Try a different AI provider

4. **Fallback to heuristic analysis**:
   - The app will use built-in analysis if AI is unavailable

---

#### "Invalid API key" error

**Cause**: API key is incorrect or expired

**Solution**:
1. Go to Settings → AI
2. Delete the current API key
3. Get a new key from the provider:
   - Google: https://makersuite.google.com/app/apikey
   - OpenAI: https://platform.openai.com/api-keys
   - Anthropic: https://console.anthropic.com/
   - Z.ai: https://platform.z.ai/
4. Enter the new key and validate

---

#### AI report is incomplete or cut off

**Cause**: Response exceeded max tokens or network interruption

**Solution**:
1. Try again (temporary issue)
2. Reduce deck size for testing
3. Check network connection
4. Try a different AI provider

---

### 3.2 AI Opponent

#### "AI opponent freezes" during game

**Cause**: AI calculation taking too long or infinite loop

**Solution**:
1. Wait up to 30 seconds for complex decisions
2. If still frozen, refresh the page
3. Try a lower difficulty level
4. Report the bug with:
   - Game state screenshot
   - Deck details
   - Steps to reproduce

---

#### AI makes obviously bad moves

**Cause**: This may be intentional (Easy difficulty) or a bug

**Solution**:
1. Check difficulty setting:
   - Easy: Makes intentional mistakes
   - Medium/Hard/Expert: Should play optimally
2. If playing on Hard/Expert and AI plays poorly, report as bug
3. Include game state details in bug report

---

#### "AI provider error" during gameplay

**Cause**: API issue or rate limit

**Solution**:
1. AI opponent will fall back to heuristic mode
2. Game continues without LLM assistance
3. Check API key configuration after game

---

### 3.3 API Configuration

#### Can't save API key

**Cause**: Browser storage issue or validation failure

**Solution**:
1. Clear browser cache
2. Ensure API key format is correct:
   - Google: Starts with `AIza`
   - OpenAI: Starts with `sk-`
   - Anthropic: Starts with `sk-ant-`
3. Try a different browser
4. Check browser console for errors

---

#### Usage tracking shows incorrect counts

**Cause**: Local storage sync issue

**Solution**:
1. Refresh the page
2. Clear usage history: Settings → AI → Clear Usage
3. Counts will reset and track accurately going forward

---

## 4. Performance Issues

### 4.1 Slow Application

#### "App runs slowly" or laggy

**Cause**: Large card database, memory leak, or browser issue

**Solution**:
1. **Clear image cache**: Settings → Database Management → Clear Image Cache
2. **Close other browser tabs** to free memory
3. **Restart the application**
4. **Check browser memory usage** (Task Manager in Chrome)
5. **Try a different browser**

---

#### High memory usage

**Cause**: Card database or image cache

**Solution**:
1. Clear image cache
2. Reduce number of open decks
3. Close and reopen application
4. Consider using web version with smaller database

---

### 4.2 Slow Search

#### Card search is slow

**Cause**: Large database or browser performance

**Solution**:
1. Wait for initial index build (first search after load)
2. Subsequent searches should be fast (<100ms)
3. If still slow, clear and rebuild database
4. Try reducing database size

---

### 4.3 Rendering Issues

#### Cards render slowly or flicker

**Cause**: GPU acceleration or browser issue

**Solution**:
1. Enable hardware acceleration in browser settings
2. Update graphics drivers
3. Disable browser extensions
4. Try a different browser

---

#### Animations stutter

**Cause**: System resources or browser issue

**Solution**:
1. Disable animations: Settings → Appearance → Animations
2. Close other applications
3. Check system resource usage

---

## 5. Multiplayer Issues

### 5.1 Connection Issues

#### "Can't connect to opponent"

**Cause**: Network, firewall, or WebRTC issue

**Solution**:
1. **Check internet connection**
2. **Verify game code** is entered correctly
3. **Check firewall settings**:
   - Allow WebRTC connections
   - Allow UDP traffic
4. **Try different network** (switch from WiFi to mobile hotspot)
5. **Disable VPN** temporarily

---

#### Connection drops during game

**Cause**: Network instability or NAT traversal issue

**Solution**:
1. Game state is preserved for reconnection
2. Rejoin using the same game code
3. If reconnection fails, start a new game
4. Try using a TURN server (contact support)

---

#### "No peers available" when browsing games

**Cause**: No public games or network issue

**Solution**:
1. Create your own game and share code with friends
2. Check if signaling server is reachable
3. Try again later

---

### 5.2 Game Sync Issues

#### Game state out of sync

**Cause**: Desync between players

**Solution**:
1. Game has automatic sync detection
2. If desync detected, game will pause
3. Host can force resync
4. If unresolved, restart game

---

#### Actions not appearing for opponent

**Cause**: Network latency or packet loss

**Solution**:
1. Wait a few seconds for action to propagate
2. Check network connection
3. Refresh page if action doesn't appear after 30 seconds

---

## 6. Build Issues

### 6.1 Development Build

#### `npm install` fails

**Cause**: Node version mismatch or network issue

**Solution**:
```bash
# Check Node version (should be 20+)
node --version

# Clear npm cache
npm cache clean --force

# Delete node_modules and reinstall
rm -rf node_modules package-lock.json
npm install

# Try with yarn if npm fails
yarn install
```

---

#### `npm run dev` fails

**Cause**: Port in use or configuration issue

**Solution**:
```bash
# Check if port 9002 is in use
lsof -i :9002

# Kill the process using the port
kill -9 <PID>

# Or use a different port
npm run dev -- -p 9003
```

---

#### TypeScript errors during build

**Cause**: Type mismatches or outdated types

**Solution**:
```bash
# Run type check to see errors
npm run typecheck

# Update type definitions
npm install --save-dev @types/node @types/react

# Fix type errors in code
```

---

### 6.2 Production Build

#### `npm run build` fails

**Cause**: Build configuration or code issue

**Solution**:
```bash
# Check for linting errors
npm run lint

# Check for type errors
npm run typecheck

# Run tests
npm test

# Try clean build
rm -rf .next
npm run build
```

---

#### Tauri build fails

**Cause**: Missing Rust dependencies or system libraries

**Solution**:
```bash
# Install Rust toolchain
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Install system dependencies (Ubuntu/Debian)
sudo apt-get install -y libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf

# For macOS
brew install webkit2gtk

# Retry build
npm run build:tauri
```

---

## 7. Common Error Messages

### Error: "IndexedDB is not supported"

**Cause**: Browser doesn't support IndexedDB or private browsing mode

**Solution**:
- Use a modern browser (Chrome, Firefox, Safari, Edge)
- Exit private/incognito browsing mode
- Enable IndexedDB in browser settings

---

### Error: "Failed to fetch" or "Network error"

**Cause**: Network connectivity issue or CORS

**Solution**:
1. Check internet connection
2. Verify Scryfall API is accessible
3. Disable ad blockers temporarily
4. Try a different network

---

### Error: "Maximum call stack size exceeded"

**Cause**: Infinite recursion in code

**Solution**:
1. Refresh the page
2. Clear browser cache
3. Report as bug with steps to reproduce

---

### Error: "WebRTC is not supported"

**Cause**: Browser doesn't support WebRTC

**Solution**:
- Use a modern browser with WebRTC support
- Enable WebRTC in browser settings
- Check that WebRTC isn't blocked by extensions

---

### Error: "Out of memory"

**Cause**: Browser ran out of memory

**Solution**:
1. Close other tabs and applications
2. Clear browser cache
3. Restart browser
4. Consider using desktop app instead

---

## 8. Getting Help

### Before Asking for Help

1. **Search existing issues**: [GitHub Issues](https://github.com/anchapin/planar-nexus/issues)
2. **Check this troubleshooting guide**
3. **Try the suggested solutions**
4. **Gather information**:
   - Platform and version
   - Browser version (if web)
   - Steps to reproduce
   - Error messages
   - Screenshots

### How to Report a Bug

Create a [GitHub Issue](https://github.com/anchapin/planar-nexus/issues/new) with:

```markdown
**Platform**: Windows 11 / macOS 14 / Linux Ubuntu 22.04 / Web (Chrome)
**Version**: 1.0.0

**Description**:
Clear description of the issue

**Steps to Reproduce**:
1. Step 1
2. Step 2
3. Step 3

**Expected Behavior**:
What should happen

**Actual Behavior**:
What actually happens

**Screenshots**:
If applicable

**Console Errors**:
From browser DevTools (F12)

**Additional Context**:
Any other relevant information
```

### Support Channels

| Channel | Best For | Response Time |
|---------|----------|---------------|
| [GitHub Issues](https://github.com/anchapin/planar-nexus/issues) | Bug reports, feature requests | 1-3 days |
| [GitHub Discussions](https://github.com/anchapin/planar-nexus/discussions) | Questions, general discussion | 1-5 days |
| Discord (if available) | Quick questions, community help | Variable |

### Providing Debug Information

**Browser Console** (Web version):
1. Press F12 to open DevTools
2. Go to Console tab
3. Copy error messages
4. Include in bug report

**Application Logs** (Desktop version):
1. Check `%APPDATA%\Planar Nexus\logs` (Windows)
2. Check `~/Library/Application Support/Planar Nexus/logs` (macOS)
3. Check `~/.config/Planar Nexus/logs` (Linux)
4. Attach log files to bug report

---

## Appendix: System Requirements

### Minimum Requirements

| Component | Requirement |
|-----------|-------------|
| **OS** | Windows 10+, macOS 10.15+, Linux Ubuntu 22.04+ |
| **CPU** | Dual-core 2.0 GHz |
| **RAM** | 4 GB |
| **Storage** | 500 MB |
| **Browser** | Chrome 90+, Firefox 88+, Safari 14+, Edge 90+ |

### Recommended Requirements

| Component | Requirement |
|-----------|-------------|
| **OS** | Windows 11+, macOS 12+, Linux Ubuntu 24.04+ |
| **CPU** | Quad-core 2.5 GHz+ |
| **RAM** | 8 GB |
| **Storage** | 1 GB SSD |
| **Browser** | Latest Chrome, Firefox, or Edge |

---

**Last Updated**: March 12, 2026  
**Version**: 1.0.0
