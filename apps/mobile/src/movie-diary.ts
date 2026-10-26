import type {Request} from './title-tracking';

interface PendingStorage {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}

/** Persist an operation ID before sending. A retry after network loss or restart reuses it. */
export function createMovieDiary(request: Request, storage: PendingStorage) {
  let saving = false;
  return {
    async record(userId: string, titleId: string) {
      if(saving) return null;
      saving = true;
      try {
        const storageKey = `barzinho.diary.${userId}.${titleId.replace(':','.')}`;
        const saved = await storage.getItemAsync(storageKey);
        let operation: {idempotencyKey: string; watchedAt: string};
        if(saved) {
          operation = JSON.parse(saved);
        } else {
          // Uniqueness only: this is not an authentication token or secret.
          operation = {idempotencyKey:`mobile:${Date.now().toString(36)}:${Math.random().toString(36).slice(2)}:${Math.random().toString(36).slice(2)}`,watchedAt:new Date().toISOString()};
          await storage.setItemAsync(storageKey,JSON.stringify(operation));
        }
        const result = await request<{created: boolean}>('/api/watch/movie',{method:'POST',body:JSON.stringify({titleId,...operation})});
        await storage.deleteItemAsync(storageKey);
        return result;
      } finally {saving=false;}
    },
  };
}
