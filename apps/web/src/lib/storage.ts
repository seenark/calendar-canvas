const REQUESTED_KEY = "persistentStorageRequested";

/** Asks the browser not to evict our data. Once per device: the answer is the browser's, asking again changes nothing. */
export function requestPersistentStorage(): void {
  if (!navigator.storage?.persist || localStorage.getItem(REQUESTED_KEY)) return;
  localStorage.setItem(REQUESTED_KEY, "1");
  void navigator.storage.persist();
}
