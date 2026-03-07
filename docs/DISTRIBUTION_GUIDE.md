# Distribution Guide

This guide covers how to distribute Planar Nexus to users across all platforms.

## Table of Contents

- [Overview](#overview)
- [Distribution Channels](#distribution-channels)
- [Web Distribution](#web-distribution)
- [Desktop Distribution](#desktop-distribution)
- [Mobile Distribution](#mobile-distribution)
- [Release Management](#release-management)
- [Update Mechanisms](#update-mechanisms)
- [Analytics and Telemetry](#analytics-and-telemetry)
- [Legal Considerations](#legal-considerations)

## Overview

Planar Nexus can be distributed through multiple channels:

1. **Web**: Hosted on static hosting platforms
2. **Desktop**: Direct downloads from website or app stores
3. **Mobile**: Direct downloads or app stores
4. **GitHub Releases**: Source code and pre-built binaries

## Distribution Channels

### Primary Distribution Channels

| Platform | Primary Channel | Secondary Channels |
|----------|-----------------|-------------------|
| Web | Vercel (recommended) | Netlify, GitHub Pages, Cloudflare Pages |
| Windows | Direct download | Microsoft Store |
| macOS | Direct download | Mac App Store |
| Linux | Direct download | Flathub, Snap Store |
| iOS | App Store (recommended) | TestFlight, direct distribution |
| Android | Google Play (recommended) | F-Droid, direct APK download |

### Recommended Strategy

**Phase 1 (Beta)**:
- Web: Vercel
- Desktop: Direct downloads from GitHub Releases
- Mobile: Beta testing via TestFlight (iOS) and Internal Testing (Android)

**Phase 2 (Public Release)**:
- Web: Vercel
- Desktop: Direct downloads + App Stores (optional)
- Mobile: App Store and Google Play Store

**Phase 3 (Growth)**:
- All channels fully operational
- Consider additional distribution partners

## Web Distribution

### Vercel (Recommended)

Vercel provides the best integration with Next.js:

#### Deployment

```bash
# Install Vercel CLI
npm install -g vercel

# Deploy to preview
vercel

# Deploy to production
vercel --prod
```

#### Configuration

Create `vercel.json` in project root:

```json
{
  "version": 2,
  "buildCommand": "npm run build",
  "outputDirectory": ".next",
  "devCommand": "npm run dev",
  "installCommand": "npm install",
  "framework": "nextjs",
  "regions": ["iad1"],
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        {
          "key": "X-Content-Type-Options",
          "value": "nosniff"
        },
        {
          "key": "X-Frame-Options",
          "value": "DENY"
        },
        {
          "key": "X-XSS-Protection",
          "value": "1; mode=block"
        }
      ]
    }
  ]
}
```

#### Environment Variables

No required environment variables for Vercel deployment.

#### Custom Domain

1. Purchase domain from registrar
2. Add domain in Vercel project settings
3. Update DNS records (provided by Vercel)
4. Enable SSL (automatic with Vercel)

### Netlify

```bash
# Install Netlify CLI
npm install -g netlify-cli

# Deploy to preview
netlify deploy

# Deploy to production
netlify deploy --prod
```

Create `netlify.toml`:

```toml
[build]
  command = "npm run build"
  publish = ".next"

[[headers]]
  for = "/*"
  [headers.values]
    X-Frame-Options = "DENY"
    X-XSS-Protection = "1; mode=block"
```

### GitHub Pages

1. Enable GitHub Pages in repository settings
2. Configure build settings:
   - Source: GitHub Actions
   - Build command: `npm run build`
   - Publish directory: `.next`

### Cloudflare Pages

```bash
# Install Wrangler CLI
npm install -g wrangler

# Deploy
wrangler pages deploy .next
```

## Desktop Distribution

### Direct Distribution

#### Website Downloads

Host installers on your website:

```html
<!-- Download section on website -->
<section id="downloads">
  <h2>Download Planar Nexus</h2>

  <div class="platform-downloads">
    <div class="windows">
      <h3>Windows</h3>
      <a href="/downloads/Planar-Nexus-0.1.0-setup.exe" class="btn btn-primary">
        Download Installer
      </a>
      <p class="system-req">Windows 10 or later (64-bit)</p>
    </div>

    <div class="macos">
      <h3>macOS</h3>
      <a href="/downloads/Planar-Nexus-0.1.0.dmg" class="btn btn-primary">
        Download DMG
      </a>
      <p class="system-req">macOS 10.15 or later</p>
    </div>

    <div class="linux">
      <h3>Linux</h3>
      <a href="/downloads/Planar-Nexus-0.1.0.AppImage" class="btn btn-primary">
        Download AppImage
      </a>
      <p class="system-req">Ubuntu 22.04+ or equivalent</p>
    </div>
  </div>
</section>
```

#### GitHub Releases

Automatically attach installers to GitHub Releases:

```bash
# Create a release with binaries
gh release create v0.1.0 \
  --title "Planar Nexus v0.1.0" \
  --notes "Release notes..." \
  src-tauri/target/release/bundle/nsis/*.exe \
  src-tauri/target/release/bundle/macos/*.dmg \
  src-tauri/target/release/bundle/appimage/*.AppImage
```

### App Stores (Optional)

#### Windows (Microsoft Store)

**Benefits**:
- Built-in update mechanism
- Trust and visibility
- Easy installation for users

**Requirements**:
- Microsoft Developer account ($19 one-time fee)
- MSIX packaging configuration
- Pass Windows certification

**Process**:
1. Package as MSIX instead of NSIS
2. Submit to Microsoft Store
3. Wait for certification (typically 1-3 days)

**Tauri Configuration**:

Update `src-tauri/tauri.conf.json`:

```json
{
  "bundle": {
    "targets": ["msi"],
    "windows": {
      "wix": {
        "language": "en-US"
      }
    }
  }
}
```

#### macOS (Mac App Store)

**Benefits**:
- Automatic updates
- Easy installation
- Trust and security

**Requirements**:
- Apple Developer Program membership ($99/year)
- App Store specific entitlements
- Pass App Store review

**Process**:
1. Configure for App Store distribution
2. Upload via Xcode or Transporter
3. Complete App Store Connect metadata
4. Submit for review (1-2 weeks)

**Challenges**:
- Strict guidelines and review process
- Revenue sharing (30%)
- Longer update cycles

#### Linux (Flathub, Snap Store)

**Flathub**:
```bash
# Create Flatpak manifest
# Submit to Flathub
# Automatic distribution to all Linux distributions
```

**Snap Store**:
```bash
# Create snapcraft.yaml
# Build snap package
# Submit to Snap Store
```

## Mobile Distribution

### iOS

#### App Store (Recommended)

**Benefits**:
- Primary distribution channel
- Automatic updates
- Trust and security

**Requirements**:
- Apple Developer Program membership ($99/year)
- Code signing certificates
- Pass App Store review

**Process**:
1. Build release IPA with proper signing
2. Create App Store Connect listing
3. Upload IPA via Xcode or Transporter
4. Complete metadata (screenshots, descriptions, etc.)
5. Submit for review
6. Wait for approval (1-2 weeks)

**Metadata Requirements**:
- App icon (1024x1024)
- Screenshots (6.5" and 5.5" iPhones, 12.9" iPad Pro)
- App description
- Keywords
- Privacy policy URL
- Support URL
- Marketing URL (optional)

#### TestFlight

For beta testing:

1. Add testers via App Store Connect
2. Upload beta build
3. Testers install TestFlight app
4. Install beta version
5. Provide feedback

#### Enterprise Distribution

For internal enterprise distribution:
1. Enroll in Apple Developer Enterprise Program ($299/year)
2. Build for distribution outside App Store
3. Host on internal server
4. Users install via manifest URL

#### Ad-Hoc Distribution

For testing on specific devices (limited to 100 devices):
1. Register device UDIDs in Apple Developer Portal
2. Build with ad-hoc provisioning profile
3. Distribute IPA directly to testers

### Android

#### Google Play Store (Recommended)

**Benefits**:
- Primary distribution channel
- Automatic updates
- Large user base

**Requirements**:
- Google Play Developer account ($25 one-time fee)
- Signing key
- Pass review process

**Process**:
1. Build release AAB
2. Create Play Console listing
3. Upload AAB
4. Complete metadata
5. Submit for review
6. Wait for approval (1-3 days)

**Metadata Requirements**:
- App icon (512x512)
- Feature graphic (1024x500)
- Screenshots (phone and tablet)
- Short description (80 chars)
- Full description
- Privacy policy URL
- Content rating

#### Internal Testing

For closed beta testing:
1. Upload AAB to internal testing track
2. Add tester email addresses
3. Testers join via opt-in URL
4. Install via Play Store

#### Closed Testing

For larger beta testing groups:
1. Create a testing track
2. Upload AAB
3. Add tester email lists (up to 100 testers)
4. Testers opt-in via Play Store

#### Open Testing

For public beta testing:
1. Create open testing track
2. Upload AAB
3. Anyone can join via Play Store listing
4. Collect feedback before full release

#### Direct APK Distribution

For users who can't access Play Store:
1. Build release APK
2. Host on website or GitHub Releases
3. Users enable "Unknown sources" in settings
4. Install APK directly

**Security Considerations**:
- Warn users about security risks
- Provide checksums for verification
- Consider anti-virus scanning

#### Alternative Stores

**Amazon Appstore**:
- Submit AAB
- Different review process
- Lower fees (20% for first $1M)

**F-Droid**:
- Requires open source license
- Requires build from source
- No Google Play Services dependencies

**Samsung Galaxy Store**:
- Samsung device users
- Additional reach

## Release Management

### Version Strategy

Follow semantic versioning (MAJOR.MINOR.PATCH):

- **MAJOR**: Incompatible API changes
- **MINOR**: New features (backwards compatible)
- **PATCH**: Bug fixes (backwards compatible)

Examples:
- `0.1.0` → `0.1.1` (patch - bug fixes)
- `0.1.0` → `0.2.0` (minor - new features)
- `0.1.0` → `1.0.0` (major - stable release)

### Release Process

#### 1. Pre-Release Checklist

- [ ] All tests passing
- [ ] Code reviewed and merged
- [ ] Documentation updated
- [ ] Release notes written
- [ ] Version numbers updated
- [ ] Translations updated (if applicable)

#### 2. Release Candidates

Create release candidates for testing:

```bash
# Tag release candidate
git tag v0.1.0-rc.1
git push origin v0.1.0-rc.1
```

Test on all platforms before final release.

#### 3. Final Release

```bash
# Update version numbers
# Edit src-tauri/tauri.conf.json and package.json

# Commit changes
git add src-tauri/tauri.conf.json package.json
git commit -m "Bump version to 0.1.0"

# Create tag
git tag v0.1.0
git push origin v0.1.0

# Create GitHub Release
gh release create v0.1.0 \
  --title "Planar Nexus v0.1.0" \
  --notes "Release notes..."
```

#### 4. Post-Release

- [ ] Verify all artifacts uploaded
- [ ] Test downloads from all sources
- [ ] Monitor for issues
- [ ] Prepare for next release cycle

### Release Notes Template

```markdown
## Planar Nexus v0.1.0

### What's New
- Feature 1 description
- Feature 2 description

### Improvements
- Improvement 1 description
- Improvement 2 description

### Bug Fixes
- Bug 1 description
- Bug 2 description

### Known Issues
- Known issue 1
- Known issue 2

### System Requirements
#### Windows
- Windows 10 or later (64-bit)

#### macOS
- macOS 10.15 (Catalina) or later

#### Linux
- Ubuntu 22.04+ or equivalent

#### iOS
- iOS 14.0 or later

#### Android
- Android 7.0 (API 24) or later

### Download Links
- [Windows](https://github.com/anchapin/planar-nexus/releases/download/v0.1.0/Planar-Nexus-setup.exe)
- [macOS](https://github.com/anchapin/planar-nexus/releases/download/v0.1.0/Planar-Nexus.dmg)
- [Linux](https://github.com/anchapin/planar-nexus/releases/download/v0.1.0/Planar-Nexus.AppImage)
- [iOS](https://apps.apple.com/app/planar-nexus/id123456789)
- [Android](https://play.google.com/store/apps/details?id=com.planarnexus.app)

### Support
- [Documentation](https://github.com/anchapin/planar-nexus/wiki)
- [Issue Tracker](https://github.com/anchapin/planar-nexus/issues)
- [Discord Community](https://discord.gg/planarnexus)
```

## Update Mechanisms

### Web Updates

Web applications update automatically when deployed:

- Deploy new version to hosting platform
- Users refresh to get updates
- Consider adding version check on app load

### Desktop Updates

#### Tauri Updater Plugin

Configure automatic updates in `src-tauri/tauri.conf.json`:

```json
{
  "plugins": {
    "updater": {
      "pubkey": "YOUR_PUBLIC_KEY",
      "endpoints": [
        "https://releases.planarnexus.app/{{target}}/{{current_version}}"
      ]
    }
  }
}
```

#### Update Server

Set up an update server that provides version information:

```json
{
  "version": "0.1.0",
  "url": "https://github.com/anchapin/planar-nexus/releases/download/v0.1.0/Planar-Nexus-0.1.0-setup.exe",
  "notes": "Release notes...",
  "signature": "UPDATE_SIGNATURE"
}
```

#### Manual Updates

For users who prefer manual updates:
- Check for updates button in app
- Download from website
- Run installer

### Mobile Updates

#### iOS Updates

- Updates automatically via App Store
- Users notified when update available
- Can disable automatic updates in settings

#### Android Updates

- Updates automatically via Play Store
- Users notified when update available
- Can enable/disable auto-updates

## Analytics and Telemetry

### Privacy-First Approach

Planar Nexus is designed as a privacy-focused application:

- No required tracking
- No required telemetry
- All data stored locally

### Optional Analytics

If you choose to add analytics:

```typescript
// src/lib/analytics.ts
export class Analytics {
  private enabled: boolean = false;

  constructor() {
    this.enabled = localStorage.getItem('analytics-enabled') === 'true';
  }

  enable() {
    this.enabled = true;
    localStorage.setItem('analytics-enabled', 'true');
  }

  disable() {
    this.enabled = false;
    localStorage.setItem('analytics-enabled', 'false');
  }

  trackEvent(eventName: string, properties?: Record<string, any>) {
    if (!this.enabled) return;

    // Send to analytics service
    // Example: Plausible, Umami, or self-hosted
  }
}
```

### Recommended Analytics Tools

**Privacy-Respecting**:
- Plausible (self-hosted or paid)
- Umami (self-hosted)
- Matomo (self-hosted)

**Mainstream**:
- Google Analytics (free but privacy concerns)
- Mixpanel (paid)
- Amplitude (paid)

### User Consent

Always obtain user consent before collecting analytics:

```typescript
// Show consent dialog on first launch
const analytics = new Analytics();

// Ask user
const consent = await showAnalyticsConsentDialog();
if (consent) {
  analytics.enable();
}
```

## Legal Considerations

### Magic: The Gathering Content

**Important**: Planar Nexus is not affiliated with Wizards of the Coast.

**To Stay Legally Safe**:
- Don't host card images directly
- Use Scryfall API for card data
- Include proper disclaimers
- Don't claim ownership of MTG content
- Follow Wizards of the Coast's Fan Content Policy

### Open Source License

The project is licensed under MIT:

- Include LICENSE file in distributions
- Display license in app
- Credit contributors
- Keep copyright notices

### Privacy Policy

Even for local-only apps, consider a privacy policy:

```markdown
# Privacy Policy for Planar Nexus

## Data Collection
Planar Nexus is a local-first application that does not collect personal data.

## Local Storage
All data is stored locally on your device:
- Deck lists
- Game saves
- User preferences

## Third-Party Services
We use the following third-party services:
- Scryfall API (for card data)
- AI providers (if user provides API keys)

## No Data Sharing
We do not share your data with third parties.

## AI API Keys
If you choose to use AI features, your API keys are stored locally and never shared.

## Contact
For privacy concerns, contact: privacy@planarnexus.app
```

### App Store Policies

#### Apple App Store

Follow Apple's App Store Review Guidelines:
- No gambling
- No in-app purchases (unless properly implemented)
- No controversial content
- Proper privacy policy
- No misleading descriptions

#### Google Play Store

Follow Google Play's Developer Policy:
- App content ratings
- Privacy policy required
- No prohibited content
- Proper permissions requested
- Data disclosure

### Code Signing

For secure distribution:

**Windows**:
- Use code signing certificate
- Timestamp signatures
- Include certificate in installer

**macOS**:
- Use Developer ID certificate
- Notarize for distribution
- Include security entitlements

**Android**:
- Sign with keystore
- Use Play App Signing
- Verify signatures

## Best Practices

### Security

1. **Code Signing**:
   - Sign all binaries
   - Use trusted certificates
   - Verify signatures on downloads

2. **Checksums**:
   ```bash
   # Generate checksums
   sha256sum Planar-Nexus-setup.exe > checksums.txt
   sha256sum Planar-Nexus.dmg >> checksums.txt

   # Verify checksums
   sha256sum -c checksums.txt
   ```

3. **Virus Scanning**:
   - Scan binaries before release
   - Use multiple antivirus engines
   - Provide scan reports

### User Experience

1. **Clear Instructions**:
   - Provide installation guides
   - Include screenshots
   - Troubleshooting section

2. **System Requirements**:
   - Clearly state requirements
   - Test on minimum specs
   - Provide performance guidelines

3. **Support Channels**:
   - Issue tracker (GitHub Issues)
   - Discord community
   - Email support
   - FAQ section

### Communication

1. **Release Announcements**:
   - Blog posts
   - Social media
   - Email newsletters
   - In-app notifications

2. **Change Log**:
   - Detailed release notes
   - Highlight major features
   - Document breaking changes

3. **Feedback Collection**:
   - In-app feedback form
   - Surveys
   - Community discussions

## Support Resources

- [Deployment Guide](DEPLOYMENT_GUIDE.md)
- [Installer Building Guide](INSTALLER_BUILDING_GUIDE.md)
- [GitHub Issues](https://github.com/anchapin/planar-nexus/issues)
- [Community Discord](https://discord.gg/planarnexus)

---

**Last Updated**: 2026-03-07
**Version**: 0.1.0
