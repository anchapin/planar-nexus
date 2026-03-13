// Jest setup for browser APIs
require('fake-indexeddb/auto');

// Testing Library matchers
require('@testing-library/jest-dom');

// Polyfill for TextEncoder/TextDecoder
global.TextEncoder = require('util').TextEncoder;
global.TextDecoder = require('util').TextDecoder;

// Polyfill for Request and Response (for service worker testing)
class MockRequest {
  constructor(url, options = {}) {
    this.url = url;
    this.method = options.method || 'GET';
    this.mode = options.mode || 'cors';
    this.destination = options.destination || 'empty';
    this.headers = options.headers ? new Headers(options.headers) : new Headers();
  }
}

class MockHeaders {
  constructor(init = {}) {
    this.headers = {};
    if (typeof init === 'object') {
      Object.entries(init).forEach(([key, value]) => {
        this.headers[key.toLowerCase()] = value;
      });
    }
  }

  append(name, value) {
    this.headers[name.toLowerCase()] = value;
  }

  delete(name) {
    delete this.headers[name.toLowerCase()];
  }

  get(name) {
    return this.headers[name.toLowerCase()];
  }

  has(name) {
    return name.toLowerCase() in this.headers;
  }

  set(name, value) {
    this.headers[name.toLowerCase()] = value;
  }
}

global.Request = MockRequest;
global.Headers = MockHeaders;
global.Response = class {
  constructor(body, init = {}) {
    this.body = body;
    this.status = init.status || 200;
    this.statusText = init.statusText || 'OK';
    this.headers = init.headers || {};
  }

  clone() {
    return new MockResponse(this.body, {
      status: this.status,
      statusText: this.statusText,
      headers: this.headers,
    });
  }
};

// Polyfill for structuredClone (required by fake-indexeddb)
if (typeof structuredClone === 'undefined') {
  global.structuredClone = (obj) => {
    return JSON.parse(JSON.stringify(obj));
  };
}

// Mock Web Crypto API for SHA-256 checksums
if (!global.crypto || !global.crypto.subtle) {
  global.crypto = global.crypto || {};
  global.crypto.subtle = {
    digest: async (algorithm, data) => {
      // Simple mock implementation for testing
      const encoder = new TextEncoder();
      const hash = Array.from(data).reduce((acc, byte) => acc + byte.toString(16).padStart(2, '0'), '');
      return new Uint8Array(hash).buffer;
    },
  };
}

// Mock localStorage
const localStorageMock = (() => {
  let store = {};
  return {
    getItem: (key) => store[key] || null,
    setItem: (key, value) => { store[key] = value; },
    removeItem: (key) => { delete store[key]; },
    clear: () => { store = {}; },
    get length() { return Object.keys(store).length; },
    key: (index) => Object.keys(store)[index] || null,
  };
})();

global.localStorage = localStorageMock;

// Mock navigator.storage
global.navigator = {
  ...global.navigator,
  storage: {
    estimate: async () => ({
      usage: 1024 * 1024, // 1MB
      quota: 50 * 1024 * 1024, // 50MB
    }),
  },
};

// ============================================================================
// Test Data Seeding Utilities
// ============================================================================

/**
 * Mock card database for testing
 * Provides consistent test data across all test suites
 */
const mockCardDatabase = {
  cards: [],
  isInitialized: false,
  
  async initialize() {
    if (this.isInitialized) return true;
    
    // Load test fixtures if available
    try {
      const { testCards } = require('./src/lib/__fixtures__/test-cards');
      this.cards = testCards;
      this.isInitialized = true;
      return true;
    } catch (err) {
      console.warn('Could not load test card fixtures:', err.message);
      this.cards = [];
      this.isInitialized = false;
      return false;
    }
  },
  
  async searchCards(query) {
    if (!this.isInitialized) await this.initialize();
    
    if (!query || query.trim() === '') {
      return this.cards;
    }
    
    const lowerQuery = query.toLowerCase();
    return this.cards.filter(card => 
      card.name.toLowerCase().includes(lowerQuery) ||
      card.types?.some(type => type.toLowerCase().includes(lowerQuery)) ||
      card.subtypes?.some(subtype => subtype.toLowerCase().includes(lowerQuery))
    );
  },
  
  async getCardByName(name) {
    if (!this.isInitialized) await this.initialize();
    return this.cards.find(card => card.name === name);
  },
  
  async getAllCards() {
    if (!this.isInitialized) await this.initialize();
    return this.cards;
  },
  
  async getCardsByColor(color) {
    if (!this.isInitialized) await this.initialize();
    return this.cards.filter(card => card.colors?.includes(color));
  },
  
  async getCardsByType(type) {
    if (!this.isInitialized) await this.initialize();
    return this.cards.filter(card => card.types?.includes(type));
  },
  
  reset() {
    this.cards = [];
    this.isInitialized = false;
  },
};

global.mockCardDatabase = mockCardDatabase;

/**
 * Clears all test data and resets mocks
 * Should be called in beforeEach for isolated tests
 */
global.clearTestData = () => {
  // Clear IndexedDB mock
  if (global.indexedDB) {
    const dbName = global.indexedDB.databases?.[0]?.name || 'test-db';
    // Note: fake-indexeddb handles cleanup automatically
  }
  
  // Clear localStorage mock
  if (global.localStorage) {
    global.localStorage.clear();
  }
  
  // Reset card database mock
  mockCardDatabase.reset();
  
  // Clear any pending timers
  jest.clearAllTimers();
};

/**
 * Seeds the database with test data
 * Should be called in beforeEach when tests need data
 */
global.seedTestData = async (customCards = []) => {
  const { testCards } = require('./src/lib/__fixtures__/test-cards');
  const cardsToSeed = customCards.length > 0 ? customCards : testCards;
  
  mockCardDatabase.cards = [...cardsToSeed];
  mockCardDatabase.isInitialized = true;
  
  // Also add cards to the actual IndexedDB for tests that use the real database
  try {
    const { addCards, initializeCardDatabase } = require('./src/lib/card-database');
    await initializeCardDatabase();
    await addCards(cardsToSeed);
  } catch (err) {
    // If the card database module isn't available or fails, continue with mock only
    console.warn('Could not seed real card database:', err.message);
  }
  
  return cardsToSeed;
};
