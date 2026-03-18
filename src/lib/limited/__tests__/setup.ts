/**
 * Jest test setup for limited mode tests
 * 
 * Provides:
 * - IndexedDB mocking via fake-indexeddb/auto
 * - Global test utilities
 */

// Mock IndexedDB for all tests
import 'fake-indexeddb/auto';

// Extend Jest timeout for async operations
jest.setTimeout(10000);

// Global beforeAll/afterAll hooks can be added here if needed
