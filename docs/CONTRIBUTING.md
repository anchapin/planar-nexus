# Contributing to Planar Nexus

Thank you for your interest in contributing to Planar Nexus! This guide will help you get started with contributing code, documentation, or bug reports.

---

## Table of Contents

1. [Code of Conduct](#1-code-of-conduct)
2. [Getting Started](#2-getting-started)
3. [Development Setup](#3-development-setup)
4. [Project Structure](#4-project-structure)
5. [Making Changes](#5-making-changes)
6. [Code Style](#6-code-style)
7. [Testing](#7-testing)
8. [Pull Request Process](#8-pull-request-process)
9. [Commit Message Format](#9-commit-message-format)
10. [Documentation](#10-documentation)
11. [Questions and Support](#11-questions-and-support)

---

## 1. Code of Conduct

### Our Pledge

We as members, contributors, and leaders pledge to make participation in our community a harassment-free experience for everyone, regardless of age, body size, visible or invisible disability, ethnicity, sex characteristics, gender identity and expression, level of experience, education, socio-economic status, nationality, personal appearance, race, caste, color, religion, or sexual identity and orientation.

### Our Standards

Examples of behavior that contributes to a positive environment:

- **Be respectful** of differing viewpoints and experiences
- **Gracefully accept** constructive criticism
- **Focus on** what is best for the community
- **Show empathy** towards other community members

Examples of unacceptable behavior:

- The use of sexualized language or imagery, and unwelcome sexual attention or advances
- Trolling, insulting or derogatory comments, and personal or political attacks
- Public or private harassment
- Publishing others' private information without explicit permission

### Enforcement

Violations of the Code of Conduct will be reviewed and investigated by the project maintainers. Violators may face consequences including temporary or permanent bans from the project.

---

## 2. Getting Started

### Prerequisites

Before you begin, ensure you have the following installed:

- **Node.js**: Version 20 or higher ([Download](https://nodejs.org/))
- **npm** or **yarn**: Package manager
- **Git**: Version control ([Download](https://git-scm.com/))
- **Code Editor**: VS Code recommended ([Download](https://code.visualstudio.com/))

### Optional (for Tauri builds)

- **Rust toolchain**: For building desktop applications ([Install](https://rustup.rs/))
- **Platform-specific build tools**: See [Deployment Guide](DEPLOYMENT_GUIDE.md)

---

## 3. Development Setup

### 3.1 Clone the Repository

```bash
# Fork the repository on GitHub, then clone your fork
git clone https://github.com/YOUR_USERNAME/planar-nexus
cd planar-nexus
```

### 3.2 Install Dependencies

```bash
# Install npm dependencies
npm install
```

### 3.3 Set Up Environment

```bash
# Create local environment file (optional, for AI features)
cp .env.example .env.local

# Edit .env.local and add your API keys if testing AI features
# GOOGLE_AI_API_KEY=your_key_here
```

### 3.4 Start Development Server

```bash
# Start the development server (runs on port 9002)
npm run dev

# Open http://localhost:9002 in your browser
```

### 3.5 Verify Setup

```bash
# Run tests to ensure everything is working
npm test

# Run type checking
npm run typecheck

# Run linting
npm run lint
```

---

## 4. Project Structure

```
planar-nexus/
├── src/
│   ├── app/                    # Next.js app router pages
│   │   ├── (app)/              # Protected routes with shared layout
│   │   │   ├── dashboard/      # Main dashboard
│   │   │   ├── deck-builder/   # Deck building interface
│   │   │   ├── deck-coach/     # AI deck coaching
│   │   │   ├── single-player/  # AI opponent gameplay
│   │   │   └── multiplayer/    # P2P multiplayer
│   │   ├── api/                # API routes
│   │   │   └── ai-proxy/       # AI proxy endpoints
│   │   ├── actions.ts          # Server actions
│   │   └── layout.tsx          # Root layout
│   ├── ai/                     # AI modules
│   │   ├── providers/          # AI provider implementations
│   │   │   ├── google.ts
│   │   │   ├── openai.ts
│   │   │   ├── claude.ts
│   │   │   └── zai.ts
│   │   ├── flows/              # Genkit AI flows
│   │   │   ├── ai-deck-coach-review.ts
│   │   │   └── ai-opponent-deck-generation.ts
│   │   ├── game-state-evaluator.ts
│   │   ├── ai-difficulty.ts
│   │   └── archetype-detector.ts
│   ├── lib/                    # Utilities and shared code
│   │   ├── game-state/         # Game engine
│   │   │   ├── types.ts
│   │   │   ├── serialization.ts
│   │   │   └── __tests__/
│   │   ├── card-database.ts    # Card database management
│   │   ├── utils.ts            # General utilities
│   │   └── ai-proxy-client.ts  # AI proxy client
│   └── components/             # React components
│       ├── ui/                 # Shadcn/ui components
│       └── ...                 # Custom components
├── src-tauri/                  # Tauri backend (Rust)
│   ├── src/
│   ├── Cargo.toml
│   └── tauri.conf.json
├── docs/                       # Documentation
├── scripts/                    # Utility scripts
│   └── fetch-cards-for-db.ts   # Card database fetcher
├── .planning/                  # GSD planning documents
├── tests/                      # Test files
├── public/                     # Static assets
├── package.json
├── tsconfig.json
├── next.config.ts
├── tailwind.config.ts
└── eslint.config.mjs
```

---

## 5. Making Changes

### 5.1 Find an Issue

- Browse [existing issues](https://github.com/anchapin/planar-nexus/issues)
- Look for issues labeled `good first issue` or `help wanted`
- Create a new issue for bugs or feature requests

### 5.2 Create a Branch

```bash
# Ensure you're on the main branch
git checkout main
git pull origin main

# Create a feature branch
git checkout -b feature/your-feature-name

# Or for bug fixes
git checkout -b fix/issue-123-short-description
```

**Branch naming conventions**:
- `feature/description` - New features
- `fix/description` - Bug fixes
- `docs/description` - Documentation changes
- `refactor/description` - Code refactoring
- `test/description` - Test additions

### 5.3 Make Your Changes

1. **Write code** following the project's coding standards
2. **Add tests** for new functionality
3. **Update documentation** if needed
4. **Run tests** to ensure nothing is broken

### 5.4 Test Your Changes

```bash
# Run unit tests
npm test

# Run tests with coverage
npm test -- --coverage

# Run E2E tests (requires Playwright browsers)
npx playwright test

# Run linting
npm run lint

# Run type checking
npm run typecheck

# Build the project
npm run build
```

### 5.5 Commit Your Changes

```bash
# Stage your changes
git add .

# Commit with a descriptive message
git commit -m "feat: Add new card search filter"

# Push to your fork
git push origin feature/your-feature-name
```

---

## 6. Code Style

### 6.1 TypeScript

- Use TypeScript for all new code
- Avoid `any` types; use proper type definitions
- Export types from dedicated type files when possible

**Good**:
```typescript
interface Card {
  name: string;
  cmc: number;
  colors: string[];
}

function getCardByName(name: string): Card | undefined {
  // Implementation
}
```

**Bad**:
```typescript
function getCardByName(name: any): any {
  // Implementation
}
```

### 6.2 React Components

- Use functional components with hooks
- Use TypeScript for props and state
- Follow the Shadcn/ui component patterns

```typescript
interface CardSearchProps {
  format?: string;
  onCardSelect?: (card: Card) => void;
}

export function CardSearch({ format, onCardSelect }: CardSearchProps) {
  const [query, setQuery] = useState('');
  
  // Component logic
  
  return (
    <div className="card-search">
      {/* JSX */}
    </div>
  );
}
```

### 6.3 CSS/Tailwind

- Use Tailwind CSS for styling
- Use the `cn()` utility for conditional classes
- Follow the existing design patterns

```typescript
import { cn } from '@/lib/utils';

function MyComponent({ isActive }: { isActive: boolean }) {
  return (
    <div className={cn(
      'base-class',
      isActive && 'active-class',
      'text-primary'
    )}>
      Content
    </div>
  );
}
```

### 6.4 ESLint Configuration

The project uses ESLint with the following configuration:

```javascript
// eslint.config.mjs
export default [
  {
    rules: {
      'no-unused-vars': 'warn',
      'no-console': 'warn',
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
];
```

### 6.5 Running Linter

```bash
# Check for linting errors
npm run lint

# Auto-fix fixable issues
npm run lint -- --fix
```

---

## 7. Testing

### 7.1 Unit Tests

Unit tests are written with Jest and React Testing Library:

```typescript
// src/ai/__tests__/archetype-detector.test.ts
import { detectArchetype } from '../archetype-detector';

describe('detectArchetype', () => {
  it('should detect Burn archetype', () => {
    const deck = [
      { name: 'Lightning Bolt', count: 4 },
      { name: 'Goblin Guide', count: 4 },
      // ... more cards
    ];
    
    const result = detectArchetype(deck);
    
    expect(result.primary).toBe('Burn');
    expect(result.confidence).toBeGreaterThan(0.7);
  });
});
```

### 7.2 Running Tests

```bash
# Run all tests
npm test

# Run specific test file
npm test -- archetype-detector.test.ts

# Run tests in watch mode
npm run test:watch

# Run tests with coverage report
npm test -- --coverage
```

### 7.3 E2E Tests

E2E tests are written with Playwright:

```typescript
// e2e/deck-builder.spec.ts
import { test, expect } from '@playwright/test';

test('should create a new deck', async ({ page }) => {
  await page.goto('/deck-builder');
  
  await page.click('[data-testid="new-deck"]');
  await page.fill('[data-testid="deck-name"]', 'Test Deck');
  await page.click('[data-testid="create-deck"]');
  
  await expect(page.locator('[data-testid="deck-name"]'))
    .toHaveText('Test Deck');
});
```

```bash
# Run E2E tests
npx playwright test

# Run with UI mode
npx playwright test --ui

# Run specific test file
npx playwright test deck-builder.spec.ts
```

### 7.4 Test Coverage Goals

- **Overall**: 70%+ coverage
- **Critical modules** (game engine, AI): 85%+ coverage
- **UI components**: 60%+ coverage

---

## 8. Pull Request Process

### 8.1 Before Submitting

- [ ] Tests pass locally (`npm test`)
- [ ] Linting passes (`npm run lint`)
- [ ] Type checking passes (`npm run typecheck`)
- [ ] Build succeeds (`npm run build`)
- [ ] Documentation updated (if applicable)
- [ ] Changelog entry added (if applicable)

### 8.2 Creating the PR

1. **Push your branch** to your fork
2. **Open a Pull Request** on GitHub
3. **Fill out the PR template**:
   - Description of changes
   - Related issues
   - Testing done
   - Screenshots (if UI changes)

### 8.3 PR Title Format

Use conventional commits format:

```
feat: Add new card search filter
fix: Resolve AI coach crash on empty deck
docs: Update API documentation
refactor: Simplify game state serialization
test: Add unit tests for archetype detector
```

### 8.4 Review Process

1. **Automated checks** run on your PR
2. **Maintainer review** - A maintainer will review your code
3. **Address feedback** - Make requested changes
4. **Approval** - Once approved, your PR will be merged

### 8.5 After Merge

- Delete your feature branch
- Monitor for any issues related to your changes
- Celebrate! 🎉

---

## 9. Commit Message Format

We follow the [Conventional Commits](https://www.conventionalcommits.org/) specification:

```
<type>(<scope>): <description>

[optional body]

[optional footer(s)]
```

### Types

| Type | Description |
|------|-------------|
| `feat` | A new feature |
| `fix` | A bug fix |
| `docs` | Documentation changes |
| `style` | Code style changes (formatting, etc.) |
| `refactor` | Code refactoring (no functional change) |
| `test` | Adding or updating tests |
| `chore` | Maintenance tasks (dependencies, config, etc.) |
| `perf` | Performance improvements |
| `ci` | CI/CD configuration changes |

### Examples

```bash
# Feature
feat(deck-builder): Add mana curve visualization

# Bug fix
fix(ai-coach): Resolve crash when analyzing empty deck

# Documentation
docs: Update contributing guide with testing instructions

# Refactor
refactor(game-state): Simplify serialization logic

# Test
test(archetype): Add unit tests for tribal detection

# Chore
chore(deps): Update Next.js to 15.5.12
```

### Scope (Optional)

The scope is optional and indicates the section of the codebase:

- `deck-builder`
- `ai-coach`
- `ai-opponent`
- `multiplayer`
- `game-state`
- `ui`
- `docs`

---

## 10. Documentation

### 10.1 Code Comments

- Add JSDoc comments for exported functions and types
- Explain complex logic with inline comments
- Keep comments up to date with code changes

```typescript
/**
 * Detects the primary archetype of a deck.
 * 
 * @param deck - Array of cards in the deck
 * @returns Archetype detection result with confidence score
 */
export function detectArchetype(deck: DeckCard[]): ArchetypeResult {
  // Implementation
}
```

### 10.2 Documentation Files

Update relevant documentation files when making changes:

- `README.md` - Project overview and quick start
- `docs/USER_GUIDE.md` - User-facing documentation
- `docs/API.md` - API documentation
- `docs/CONTRIBUTING.md` - This file

### 10.3 Running Documentation Checks

```bash
# Check for broken links (if script available)
npm run docs:check

# Build documentation (if applicable)
npm run docs:build
```

---

## 11. Questions and Support

### Getting Help

- **GitHub Issues**: [Open an issue](https://github.com/anchapin/planar-nexus/issues) for bugs or feature requests
- **GitHub Discussions**: [Start a discussion](https://github.com/anchapin/planar-nexus/discussions) for questions
- **Discord**: Join our community server (link in README)

### Resources

- [Next.js Documentation](https://nextjs.org/docs)
- [React Documentation](https://react.dev/)
- [TypeScript Documentation](https://www.typescriptlang.org/docs/)
- [Shadcn/ui Documentation](https://ui.shadcn.com/)
- [Genkit Documentation](https://firebase.google.com/docs/genkit)

### First-Time Contributors

If this is your first open-source contribution:

1. Read [How to Contribute to Open Source](https://opensource.guide/how-to-contribute/)
2. Start with issues labeled `good first issue`
3. Don't hesitate to ask questions
4. Be patient with the review process

---

## Thank You!

Your contributions make Planar Nexus better for everyone. We appreciate your time and effort!

---

**Last Updated**: March 12, 2026  
**Version**: 1.0.0
