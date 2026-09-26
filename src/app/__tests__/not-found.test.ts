import { metadata } from "../not-found";

describe("not-found metadata", () => {
  it("has correct title", () => {
    expect(metadata.title).toBe("404 Not Found | Planar Nexus");
  });
});
