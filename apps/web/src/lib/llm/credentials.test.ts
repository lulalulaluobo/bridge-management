import { describe, expect, it } from "vitest";

import { decryptSecret, encryptSecret } from "@/lib/llm/crypto";

describe("BYOK encryption", () => {
  it("uses authenticated encryption and rejects a changed ciphertext", () => {
    const encrypted = encryptSecret("sk-example-secret", "household:openai", Buffer.alloc(32, 7));
    expect(decryptSecret(encrypted, "household:openai", Buffer.alloc(32, 7))).toBe("sk-example-secret");
    const alteredCiphertext = `${encrypted.ciphertext[0] === "A" ? "B" : "A"}${encrypted.ciphertext.slice(1)}`;
    expect(() => decryptSecret({ ...encrypted, ciphertext: alteredCiphertext }, "household:openai", Buffer.alloc(32, 7))).toThrow();
  });
});
