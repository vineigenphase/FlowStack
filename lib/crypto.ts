/** Token encryption: libsodium secretbox, key from TOKEN_ENC_KEY (32 bytes, base64). Output = nonce || ciphertext. */
import sodium from "libsodium-wrappers";
import { env } from "@/lib/env";

async function key(): Promise<Uint8Array> {
  await sodium.ready;
  const k = Buffer.from(env().TOKEN_ENC_KEY || "", "base64");
  if (k.length !== sodium.crypto_secretbox_KEYBYTES) {
    throw new Error("TOKEN_ENC_KEY must be 32 bytes, base64 (openssl rand -base64 32)");
  }
  return new Uint8Array(k);
}

export async function seal(plain: string): Promise<Uint8Array> {
  const k = await key();
  const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
  const box = sodium.crypto_secretbox_easy(sodium.from_string(plain), nonce, k);
  const out = new Uint8Array(nonce.length + box.length);
  out.set(nonce, 0);
  out.set(box, nonce.length);
  return out;
}

export async function open(sealed: Uint8Array): Promise<string> {
  const k = await key();
  const n = sodium.crypto_secretbox_NONCEBYTES;
  const plain = sodium.crypto_secretbox_open_easy(sealed.slice(n), sealed.slice(0, n), k);
  return sodium.to_string(plain);
}
