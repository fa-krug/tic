import { Entry } from '@napi-rs/keyring';

const SERVICE = 'tic';

/**
 * Retrieve a token from the system keychain.
 * Returns null if no token is found for the given account.
 */
export function getToken(account: string): string | null {
  const entry = new Entry(SERVICE, account);
  try {
    return entry.getPassword();
  } catch {
    return null;
  }
}

/**
 * Store a token in the system keychain.
 */
export function setToken(account: string, token: string): void {
  const entry = new Entry(SERVICE, account);
  entry.setPassword(token);
}

/**
 * Remove a token from the system keychain.
 * No-op if no token is found for the given account.
 */
export function deleteToken(account: string): void {
  const entry = new Entry(SERVICE, account);
  try {
    entry.deletePassword();
  } catch {
    // No-op if not found
  }
}
