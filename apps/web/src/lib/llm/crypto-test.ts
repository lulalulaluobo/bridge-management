import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

type Encrypted = { ciphertext: string; iv: string; authTag: string };

function encrypt(secret: string, aad: string, key: Buffer): Encrypted {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(aad));
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return { ciphertext: ciphertext.toString("base64"), iv: iv.toString("base64"), authTag: cipher.getAuthTag().toString("base64") };
}

function decrypt(encrypted: Encrypted, aad: string, key: Buffer) {
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(encrypted.iv, "base64"));
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(Buffer.from(encrypted.authTag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(encrypted.ciphertext, "base64")), decipher.final()]).toString("utf8");
}

export const __test__ = { encrypt, decrypt };
