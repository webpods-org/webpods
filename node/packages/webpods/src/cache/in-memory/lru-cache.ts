import type { CacheEntry, CacheStats } from "../types.js";

type LRUNode<T> = {
  key: string;
  entry: CacheEntry<T>;
  prev: LRUNode<T> | null;
  next: LRUNode<T> | null;
};

export type LRUCache<T = unknown> = {
  get: (key: string) => T | null;
  set: (key: string, value: T, ttlSeconds: number) => void;
  delete: (key: string) => boolean;
  deletePattern: (pattern: string) => number;
  clear: (pattern?: string) => void;
  getStats: () => CacheStats;
  checkSize: (value: unknown) => number;
};

export function createLRUCache<T>(maxEntries: number): LRUCache<T> {
  const cache = new Map<string, LRUNode<T>>();
  let head: LRUNode<T> | null = null;
  let tail: LRUNode<T> | null = null;
  let currentSize = 0;
  let stats: CacheStats = {
    hits: 0,
    misses: 0,
    evictions: 0,
    currentSize: 0,
    entryCount: 0,
  };

  // Helper to calculate approximate size in bytes
  function calculateSize(value: unknown): number {
    if (value === null || value === undefined) return 0;
    if (typeof value === "string") return value.length * 2; // UTF-16
    if (typeof value === "number") return 8;
    if (typeof value === "boolean") return 4;
    if (value instanceof Date) return 8;
    if (value instanceof Buffer) return value.length;
    if (typeof value === "object") {
      // Rough estimation for objects
      return JSON.stringify(value).length * 2;
    }
    return 0;
  }

  // Move node to head (most recently used)
  function moveToHead(node: LRUNode<T>): void {
    if (node === head) return;

    // Remove from current position
    if (node.prev) node.prev.next = node.next;
    if (node.next) node.next.prev = node.prev;
    if (node === tail) tail = node.prev;

    // Move to head
    node.prev = null;
    node.next = head;
    if (head) head.prev = node;
    head = node;
    if (!tail) tail = node;
  }

  // Remove node
  function removeNode(node: LRUNode<T>): void {
    if (node.prev) node.prev.next = node.next;
    if (node.next) node.next.prev = node.prev;
    if (node === head) head = node.next;
    if (node === tail) tail = node.prev;
  }

  // Evict least recently used
  function evictLRU(): void {
    if (!tail) return;

    const node = tail;
    removeNode(node);
    cache.delete(node.key);
    currentSize -= node.entry.size;
    stats.evictions++;
    stats.entryCount--;
  }

  // Check if entry is expired
  function isExpired(entry: CacheEntry<T>): boolean {
    return Date.now() > entry.expiresAt;
  }

  return {
    get(key: string): T | null {
      const node = cache.get(key);
      if (!node) {
        stats.misses++;
        return null;
      }

      // Check expiration
      if (isExpired(node.entry)) {
        removeNode(node);
        cache.delete(key);
        currentSize -= node.entry.size;
        stats.entryCount--;
        stats.misses++;
        return null;
      }

      // Update stats and move to head
      stats.hits++;
      node.entry.hits++;
      moveToHead(node);
      return node.entry.value;
    },

    set(key: string, value: T, ttlSeconds: number): void {
      const size = calculateSize(value);
      const now = Date.now();
      const entry: CacheEntry<T> = {
        value,
        size,
        expiresAt: now + ttlSeconds * 1000,
        hits: 0,
        createdAt: now,
      };

      // Update existing entry
      const existingNode = cache.get(key);
      if (existingNode) {
        currentSize -= existingNode.entry.size;
        existingNode.entry = entry;
        currentSize += size;
        moveToHead(existingNode);
        return;
      }

      // Evict if at capacity
      while (cache.size >= maxEntries && tail) {
        evictLRU();
      }

      // Add new entry
      const node: LRUNode<T> = {
        key,
        entry,
        prev: null,
        next: head,
      };

      if (head) head.prev = node;
      head = node;
      if (!tail) tail = node;

      cache.set(key, node);
      currentSize += size;
      stats.entryCount++;
    },

    delete(key: string): boolean {
      const node = cache.get(key);
      if (!node) return false;

      removeNode(node);
      cache.delete(key);
      currentSize -= node.entry.size;
      stats.entryCount--;
      return true;
    },

    deletePattern(pattern: string): number {
      // Pattern matching for selective deletion
      // Convert wildcard pattern to regex (e.g., "pod-streams:test:*" -> "^pod-streams:test:.*$")
      const regex = new RegExp(
        "^" + pattern.replace(/\*/g, ".*").replace(/\?/g, ".") + "$",
      );
      const keysToDelete: string[] = [];

      for (const [key, node] of cache.entries()) {
        if (regex.test(key)) {
          keysToDelete.push(key);
          removeNode(node);
          currentSize -= node.entry.size;
          stats.entryCount--;
        }
      }

      keysToDelete.forEach((key) => cache.delete(key));
      return keysToDelete.length;
    },

    clear(pattern?: string): void {
      if (!pattern) {
        cache.clear();
        head = null;
        tail = null;
        currentSize = 0;
        stats.entryCount = 0;
        return;
      }

      // Use deletePattern for pattern-based clearing
      this.deletePattern(pattern);
    },

    getStats(): CacheStats {
      return {
        ...stats,
        currentSize,
      };
    },

    checkSize(value: unknown): number {
      return calculateSize(value);
    },
  };
}