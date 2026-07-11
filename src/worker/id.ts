const ENCODING = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function encodeTime(now: number): string {
  let value = now;
  let result = "";
  for (let index = 0; index < 10; index += 1) {
    result = ENCODING[value % 32] + result;
    value = Math.floor(value / 32);
  }
  return result;
}

function encodeRandom(): string {
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  let result = "";
  for (let index = 0; index < 16; index += 1) {
    const byte = bytes[index % bytes.length];
    result += ENCODING[byte % 32];
  }
  return result;
}

export function ulid(prefix?: string): string {
  const id = `${encodeTime(Date.now())}${encodeRandom()}`;
  return prefix ? `${prefix}_${id}` : id;
}
