/// <reference types="jest" />

declare global {
  function seedTestData(customCards?: unknown[]): Promise<unknown[]>;
  function clearTestData(): void;
}

export {};
