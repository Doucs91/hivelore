import { describe, expect, it } from "vitest";
import { suggestTopicKey } from "../src/topic-suggest.js";

describe("suggestTopicKey", () => {
  it("maps architecture to architecture family slug", () => {
    expect(suggestTopicKey("architecture", "Embedder abstraction")).toEqual({
      family: "architecture",
      topic_key: "architecture/embedder-abstraction",
    });
  });

  it("fallback family for unknown type", () => {
    expect(suggestTopicKey("unknown", "X")).toEqual({
      family: "discovery",
      topic_key: "discovery/x",
    });
  });
});
