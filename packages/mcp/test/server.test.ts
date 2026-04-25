import { describe, expect, it } from "vitest";
import { createHaiveServer, SERVER_NAME, SERVER_VERSION } from "../src/server.js";

describe("createHaiveServer", () => {
  it("constructs an McpServer with the expected identity", () => {
    const { server, context } = createHaiveServer({ root: process.cwd() });
    expect(server).toBeDefined();
    expect(context.paths.root).toBeTruthy();
    expect(SERVER_NAME).toBe("haive");
    expect(SERVER_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
