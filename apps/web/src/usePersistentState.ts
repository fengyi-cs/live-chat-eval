import { useEffect, useState } from 'react';

export function usePersistentState<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => {
    const raw = localStorage.getItem(key);
    if (raw === null) return initial;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return initial;
    }
  });

  useEffect(() => {
    if (value === null || value === undefined) {
      localStorage.removeItem(key);
      window.dispatchEvent(new StorageEvent('storage', { key, newValue: null, storageArea: localStorage }));
    } else {
      const json = JSON.stringify(value);
      localStorage.setItem(key, json);
      window.dispatchEvent(new StorageEvent('storage', { key, newValue: json, storageArea: localStorage }));
    }
  }, [key, value]);

  // Sync with other component instances using the same key in the same window
  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key !== key || e.storageArea !== localStorage) return;
      if (e.newValue === null) {
        setValue(initial);
        return;
      }
      try {
        setValue(JSON.parse(e.newValue) as T);
      } catch {
        setValue(initial);
      }
    };
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return [value, setValue] as const;
}
