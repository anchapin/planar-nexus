---
name: component-generator
description: Generate Shadcn/ui components following project conventions
argument-hint: "[component-type] [--variant VARIANT] [--props PROPS] [--path PATH]"
allowed-tools: Bash, Read, Write, Glob
---

# Component Generator

Generate Shadcn/ui and custom components following Planar Nexus conventions.

## Usage

### Generate a Shadcn/ui component
```bash
/component-generator button
```

### Generate with specific variant
```bash
/component-generator card --variant outlined
```

### Generate with custom props
```bash
/component-generator input --props "label,placeholder,onChange,value"
```

### Generate in specific path
```bash
/component-generator deck-list --path src/components/deck-builder
```

## Available Component Types

### Shadcn/ui Core Components
- **button** - Button with variants (default, destructive, outline, secondary, ghost, link)
- **card** - Card container with header, content, footer slots
- **input** - Form input with label and validation
- **select** - Dropdown select with Radix UI primitives
- **dialog** - Modal dialog with accessible focus management
- **tabs** - Tabbed interface with content panels
- **accordion** - Collapsible content sections
- **tooltip** - Hover tooltip with delay
- **toast** - Notification toast messages
- **avatar** - User avatar with fallback
- **checkbox** - Accessible checkbox
- **switch** - Toggle switch
- **slider** - Range slider
- **progress** - Progress indicator
- **badge** - Status badge
- **separator** - Visual divider
- **scroll-area** - Custom scrollable area
- **collapsible** - Expandable/collapsible content
- **popover** - Popover menu
- **dropdown-menu** - Context menu
- **menubar** - Menu bar
- **radio-group** - Radio button group
- **label** - Form label
- **table** - Data table

### Custom Components (Planar Nexus)
- **card-display** - Magic card display component
- **deck-list** - Deck list with search and filtering
- **card-search** - Card search interface
- **mana-base** - Mana base analyzer
- **game-board** - Game board layout
- **player-zone** - Player zone (hand, battlefield, graveyard)
- **combat-resolver** - Combat damage resolver
- **deck-stats** - Deck statistics display

## Component Templates

### Button Component
```tsx
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface CustomButtonProps {
  variant?: "default" | "destructive" | "outline" | "secondary" | "ghost" | "link";
  size?: "default" | "sm" | "lg" | "icon";
  children: React.ReactNode;
  onClick?: () => void;
  className?: string;
  disabled?: boolean;
}

export function CustomButton({
  variant = "default",
  size = "default",
  children,
  onClick,
  className,
  disabled,
}: CustomButtonProps) {
  return (
    <Button
      variant={variant}
      size={size}
      onClick={onClick}
      className={cn(className)}
      disabled={disabled}
    >
      {children}
    </Button>
  );
}
```

### Card Component
```tsx
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface CustomCardProps {
  title?: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}

export function CustomCard({
  title,
  description,
  children,
  footer,
  className,
}: CustomCardProps) {
  return (
    <Card className={cn(className)}>
      {(title || description) && (
        <CardHeader>
          {title && <CardTitle>{title}</CardTitle>}
          {description && <CardDescription>{description}</CardDescription>}
        </CardHeader>
      )}
      <CardContent>{children}</CardContent>
      {footer && <CardFooter>{footer}</CardFooter>}
    </Card>
  );
}
```

## Workflow

### 1. Component Discovery
- Checks if Shadcn/ui component exists in `/src/components/ui/`
- Reads existing component patterns for consistency

### 2. Generation
- Creates component file with proper TypeScript types
- Follows project naming conventions (PascalCase, descriptive names)
- Includes proper imports from `@/` path aliases
- Uses `cn()` utility for class name merging

### 3. Validation
- Runs TypeScript type check
- Verifies imports resolve correctly
- Checks for naming conflicts

### 4. Installation (Shadcn/ui only)
If component doesn't exist, offers to install:
```bash
npx shadcn@latest add <component>
```

## Conventions

### File Structure
```
src/components/
├── ui/           # Shadcn/ui primitives
├── deck-builder/ # Feature-specific components
├── game/         # Game-related components
└── layout/       # Layout components
```

### Import Patterns
```tsx
// Shadcn/ui components
import { Button } from "@/components/ui/button";

// Custom components
import { CardDisplay } from "@/components/game/card-display";

// Utilities
import { cn } from "@/lib/utils";
```

### Props Interface
- Use `interface` over `type` for component props
- Prefix with component name: `CardDisplayProps`
- Include `className?: string` for all wrapper components
- Use `children: React.ReactNode` for content slots
- Export props interface for external use

### Styling
- Dark mode by default (project uses dark theme)
- Use Tailwind CSS utility classes
- Use `cn()` for conditional classes
- Follow Radix UI data attributes for state styling

## Examples

### Generate a new feature component
```bash
/component-generator deck-stats --props "deck,format,curve" --path src/components/deck-builder
```

### Generate with Shadcn installation
```bash
/component-generator popover
# If not exists, will suggest: npx shadcn@latest add popover
```

### Generate a game component
```bash
/component-generator combat-stack --path src/components/game
```

## Output

Generated components include:
- ✅ TypeScript interface for props
- ✅ Proper imports and path aliases
- ✅ Default prop values
- ✅ Accessible markup (ARIA where needed)
- ✅ Dark mode compatible styles
- ✅ Export statement

## Troubleshooting

### Component already exists
Skill will detect existing components and offer to:
1. Skip generation
2. Overwrite (with confirmation)
3. Create variant (e.g., `ButtonOutlined`)

### Missing Shadcn dependency
Will suggest running:
```bash
npx shadcn@latest add <component>
```

### Import errors
Verifies path aliases in `tsconfig.json`:
```json
{
  "compilerOptions": {
    "paths": {
      "@/*": ["./src/*"]
    }
  }
}
```
