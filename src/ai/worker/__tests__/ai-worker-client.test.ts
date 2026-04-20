/**
 * AI Worker Client Integration Tests
 */

// Mock comlink before any imports that use it
jest.mock("comlink", () => ({
  wrap: jest.fn().mockReturnValue({}),
}));

describe("AI Worker Client", () => {
  // Mock Worker and URL
  beforeAll(() => {
    // @ts-expect-error Worker mock
    global.Worker = class {
      constructor(url: string) {}
      postMessage(msg: any) {}
      terminate() {}
      addEventListener(type: string, listener: any) {}
      removeEventListener(type: string, listener: any) {}
    };

    // @ts-expect-error URL mock
    global.URL = class {
      constructor(path: string, base?: string) {
        return { href: path };
      }
    };
  });

  it("should initialize successfully as a singleton", async () => {
    const { aiWorkerClient } = await import("../ai-worker-client");
    expect(aiWorkerClient).toBeDefined();

    const { aiWorkerClient: secondInstance } =
      await import("../ai-worker-client");
    expect(aiWorkerClient).toBe(secondInstance);
  });
});
