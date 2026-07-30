import { describe, expect, it } from "vitest";

import { __test__ } from "@/lib/llm/crypto-test";

describe("BYOK encryption", () => {
  it("uses authenticated encryption and rejects a changed ciphertext", () => {
    const encrypted = __test__.encrypt("sk-example-secret", "household:openai", Buffer.alloc(32, 7));
    expect(__test__.decrypt(encrypted, "household:openai", Buffer.alloc(32, 7))).toBe("sk-example-secret");
    expect(() => __test__.decrypt({ ...encrypted, ciphertext: `${encrypted.ciphertext}x` }, "household:openai", Buffer.alloc(32, 7))).toThrow();
  });
});
