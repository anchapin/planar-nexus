/**
 * Test Utilities Library
 * 
 * Provides reusable testing utilities for consistent, maintainable tests.
 * 
 * @packageDocumentation
 */

// Helpers
export { renderWithProviders } from './helpers/render';
export * from './helpers/queries';
export { createUserEvent, clickCard, addToDeck } from './helpers/user-event';

// Mocks
export { mockFetch, mockScryfallSearch, mockScryfallCard } from './__mocks__/fetch';
export { mockLocalStorage, mockSessionStorage, createStorageMock } from './__mocks__/storage';
export { mockUseRouter, createMockRouter } from './__mocks__/next-router';

// Factories
export { createCard, createLand, createCreature, createSpell } from './factories/card';
export { createDeck, createLimitedDeck, createStandardDeck } from './factories/deck';
export { createGameState, createMulliganState, createCombatState } from './factories/game-state';

// Integration Testing
export { 
  startServer, 
  stopServer, 
  resetHandlers, 
  useHandlers,
  createMockDeck,
  createMockDecklist,
  createMockScryfallCard,
  serverHandlers 
} from './integration';
export { createWorker, handlers as mswHandlers, createMockScryfallCard as createCardResponse } from './msw/handlers';
export { createServer, serverHandlers as mswServerHandlers, createMockScryfallCard as createServerCardResponse } from './msw/server';
