// Jest setup for browser APIs
require('fake-indexeddb/auto');

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
