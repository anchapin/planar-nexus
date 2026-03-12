# Add Error Handling to Async Operations

**Priority:** 🟠 HIGH  
**Labels:** `high`, `error-handling`, `reliability`  
**Milestone:** v0.2.0 Stability  
**Estimated Effort:** 2-3 days

---

## Description

Multiple files have **empty catch blocks** that silently swallow errors, making debugging impossible and leading to inconsistent state.

---

## Affected Files

| File | Line | Problem |
|------|------|---------|
| `src/hooks/use-storage-backup.ts` | 90 | Empty catch |
| `src/lib/connection-fallback.ts` | 175 | Empty catch |
| `src/lib/websocket-connection.ts` | 306 | Empty catch |
| Multiple files | Various | Silent failures |

---

## Current Problematic Code

```typescript
// ❌ BAD - Silent failure
try {
  await saveBackup(data);
} catch (error) {
  // Silently ignored!
}

// ❌ BAD - Empty catch
fetch(url)
  .then(response => response.json())
  .catch(() => {}); // What happened??
```

---

## Impact

1. **Impossible to Debug:** No logs of what went wrong
2. **Inconsistent State:** Operations fail without recovery
3. **Poor UX:** Users get no feedback
4. **Data Loss:** Saves fail silently

---

## Required Changes

### Step 1: Add Error Logging

```typescript
// ✅ GOOD - Log error
try {
  await saveBackup(data);
} catch (error) {
  console.error('Backup failed:', error);
  // Add recovery or user notification
}
```

### Step 2: Add User Notifications

```typescript
// ✅ GOOD - Notify user
try {
  await saveBackup(data);
} catch (error) {
  console.error('Backup failed:', error);
  toast({
    title: 'Backup Failed',
    description: 'Your changes may not be saved',
    variant: 'destructive',
  });
}
```

### Step 3: Add Recovery Logic

```typescript
// ✅ GOOD - Attempt recovery
try {
  await saveBackup(data);
} catch (error) {
  console.error('Backup failed:', error);
  
  // Try fallback storage
  try {
    await saveToLocalStorage(data);
    toast({
      title: 'Backup Failed',
      description: 'Saved to local storage instead',
    });
  } catch (fallbackError) {
    console.error('Fallback also failed:', fallbackError);
    toast({
      title: 'Save Failed',
      description: 'Could not save your changes',
      variant: 'destructive',
    });
  }
}
```

### Step 4: Update All Empty Catch Blocks

```typescript
// Before
.catch(() => {})

// After
.catch((error) => {
  console.error('Operation failed:', error);
  // Handle error appropriately
})
```

---

## Acceptance Criteria

- [ ] **Zero** empty catch blocks in codebase
- [ ] **All errors** logged appropriately
- [ ] **Users notified** of critical failures
- [ ] **Recovery logic** added where possible
- [ ] **Tests** cover error scenarios
- [ ] **Error messages** are helpful and actionable

---

## Error Handling Patterns

### Pattern 1: Retry Logic
```typescript
async function fetchWithRetry(url: string, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fetch(url);
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      console.warn(`Fetch failed, retrying (${i + 1}/${maxRetries}):`, error);
      await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
    }
  }
}
```

### Pattern 2: Error Boundaries
```typescript
// React error boundary for UI
class ErrorBoundary extends React.Component {
  state = { hasError: false };
  
  static getDerivedStateFromError(error) {
    return { hasError: true };
  }
  
  componentDidCatch(error, errorInfo) {
    console.error('UI Error:', error, errorInfo);
  }
  
  render() {
    if (this.state.hasError) {
      return <ErrorFallback />;
    }
    return this.props.children;
  }
}
```

### Pattern 3: Error Types
```typescript
// Custom error types for better handling
class AppError extends Error {
  constructor(
    message: string,
    public code: string,
    public recoverable: boolean = true
  ) {
    super(message);
    this.name = 'AppError';
  }
}

// Usage
throw new AppError('Save failed', 'SAVE_FAILED', true);
```

---

## Testing

### Unit Tests
```typescript
describe('Error Handling', () => {
  it('should log error when backup fails', async () => {
    const consoleSpy = jest.spyOn(console, 'error');
    mockSaveBackup.mockRejectedValue(new Error('Network error'));
    
    await saveBackup(data);
    
    expect(consoleSpy).toHaveBeenCalledWith(
      'Backup failed:',
      expect.any(Error)
    );
  });
  
  it('should notify user when save fails', async () => {
    mockSaveBackup.mockRejectedValue(new Error('Network error'));
    
    await saveBackup(data);
    
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Backup Failed',
        variant: 'destructive',
      })
    );
  });
});
```

---

## Related Issues

- #518 (Add consistent error handling to API fetch calls)
- #616 (Add retry logic for failed AI requests)

---

## Audit Command

```bash
# Find all empty catch blocks
grep -rn "\.catch.*{}" src/
grep -rn "catch.*{}" src/

# Find catch blocks without console.error
# (Manual review needed)
```

---

## Priority Order

1. **Data loss scenarios** (save failures) - Fix immediately
2. **Network failures** (API calls) - Fix this week
3. **UI failures** (non-critical) - Fix soon
4. **Logging failures** (debug only) - Fix when possible
