/**
 * User event setup
 * 
 * Provides pre-configured userEvent.setup() for consistent interaction testing
 * and custom interaction helpers for common card game actions.
 */

import userEvent from '@testing-library/user-event';
import { RenderResult } from '@testing-library/react';

/**
 * Pre-configured user event instance
 * Use this instead of importing userEvent directly in tests
 */
export const createUserEvent = () => {
  return userEvent.setup();
};

/**
 * Default user event instance for convenience
 * Note: This should be initialized within each test
 */
let defaultUser: ReturnType<typeof userEvent.setup> | null = null;

/**
 * Get or create the default user event instance
 * Must be called after render in a test context
 */
export function getDefaultUser() {
  if (!defaultUser) {
    defaultUser = userEvent.setup();
  }
  return defaultUser;
}

/**
 * Reset the default user event instance
 * Call this in test teardown or afterEach
 */
export function resetDefaultUser() {
  defaultUser = null;
}

/**
 * Custom interaction helpers for card game interactions
 */

/**
 * Click on a card element
 * 
 * @param cardElement - The card element to click
 * @param options - User event options
 */
export async function clickCard(
  cardElement: HTMLElement,
  options?: { clickCount?: number; shiftKey?: boolean }
): Promise<void> {
  const user = getDefaultUser();
  if (options?.clickCount === 2) {
    await user.dblClick(cardElement);
  } else {
    await user.click(cardElement);
  }
}

/**
 * Add a card to a deck (simplified - use click for now)
 * 
 * @param cardElement - The card element to add
 * @param deckElement - The deck element to add to
 */
export async function addToDeck(
  cardElement: HTMLElement,
  deckElement: HTMLElement
): Promise<void> {
  const user = getDefaultUser();
  // Simplified: click the card first to select it
  await user.click(cardElement);
}

/**
 * Click a card to reveal it (for face-down cards)
 * 
 * @param cardElement - The face-down card element
 */
export async function revealCard(cardElement: HTMLElement): Promise<void> {
  const user = getDefaultUser();
  await user.click(cardElement);
}

/**
 * Select a card from a list
 * 
 * @param cardElement - The card element to select
 */
export async function selectCard(cardElement: HTMLElement): Promise<void> {
  const user = getDefaultUser();
  // Click for selection
  await user.click(cardElement);
}

/**
 * Open a card's detail view
 * 
 * @param cardElement - The card element to open
 */
export async function openCardDetail(cardElement: HTMLElement): Promise<void> {
  const user = getDefaultUser();
  // Double-click to open detail
  await user.dblClick(cardElement);
}

/**
 * Close a modal or popup
 * 
 * @param closeButton - The close button element
 */
export async function closeModal(closeButton: HTMLElement): Promise<void> {
  const user = getDefaultUser();
  await user.click(closeButton);
}

/**
 * Type in an input field
 * 
 * @param inputElement - The input element
 * @param text - The text to type
 */
export async function typeInInput(
  inputElement: HTMLElement,
  text: string
): Promise<void> {
  const user = getDefaultUser();
  await user.type(inputElement, text);
}

/**
 * Clear and type in an input field
 * 
 * @param inputElement - The input element
 * @param text - The text to type
 */
export async function clearAndType(
  inputElement: HTMLElement,
  text: string
): Promise<void> {
  const user = getDefaultUser();
  await user.clear(inputElement);
  await user.type(inputElement, text);
}

/**
 * Select an option from a select/dropdown
 * 
 * @param selectElement - The select element
 * @param optionText - The text of the option to select
 */
export async function selectOption(
  selectElement: HTMLElement,
  optionText: string
): Promise<void> {
  const user = getDefaultUser();
  await user.selectOptions(selectElement, optionText);
}

/**
 * Hover over an element
 * 
 * @param element - The element to hover
 */
export async function hoverOver(element: HTMLElement): Promise<void> {
  const user = getDefaultUser();
  await user.hover(element);
}

/**
 * Press a keyboard key
 * 
 * @param key - The key to press
 */
export async function pressKey(key: string): Promise<void> {
  const user = getDefaultUser();
  await user.keyboard(key);
}

/**
 * Wait for a specified duration (for testing timeouts)
 * 
 * @param ms - Milliseconds to wait
 */
export async function waitForMs(ms: number): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Combined helper that creates a user event and provides all interaction helpers
 * Call this at the beginning of each test
 * 
 * @returns Object with user and all interaction helpers
 * 
 * @example
 * const { user, clickCard, addToDeck } = setupUserEvent();
 * render(<MyComponent />);
 * await clickCard(screen.getByTestId('card-1'));
 */
export function setupUserEvent() {
  const user = createUserEvent();
  
  return {
    user,
    clickCard: (element: HTMLElement, options?: { clickCount?: number; shiftKey?: boolean }) => 
      clickCard(element, options),
    addToDeck: (card: HTMLElement, deck: HTMLElement) => addToDeck(card, deck),
    revealCard: (element: HTMLElement) => revealCard(element),
    selectCard: (element: HTMLElement) => selectCard(element),
    openCardDetail: (element: HTMLElement) => openCardDetail(element),
    closeModal: (element: HTMLElement) => closeModal(element),
    typeInInput: (element: HTMLElement, text: string) => typeInInput(element, text),
    clearAndType: (element: HTMLElement, text: string) => clearAndType(element, text),
    selectOption: (element: HTMLElement, option: string) => selectOption(element, option),
    hoverOver: (element: HTMLElement) => hoverOver(element),
    pressKey: (key: string) => pressKey(key),
    waitForMs: (ms: number) => waitForMs(ms),
  };
}

export default {
  createUserEvent,
  getDefaultUser,
  resetDefaultUser,
  setupUserEvent,
  clickCard,
  addToDeck,
};
