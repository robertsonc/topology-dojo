/** The browser's local storage, or null where it cannot be reached. */
export function browserStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
