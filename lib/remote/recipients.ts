type Recipient = { id: string; to: string; expiresAt: number };

const KEY = "__jarvisMark7RemoteRecipients";
const store = globalThis as typeof globalThis & {
  [KEY]?: Map<string, Recipient>;
};

function map() {
  if (!store[KEY]) store[KEY] = new Map();
  return store[KEY]!;
}

export function rememberRemoteRecipient(id: string, to: string) {
  map().set(id, { id, to, expiresAt: Date.now() + 10 * 60_000 });
}

export function getRemoteRecipient(id: string): string | null {
  const entry = map().get(id);
  if (!entry || entry.expiresAt < Date.now()) {
    map().delete(id);
    return null;
  }
  return entry.to;
}
