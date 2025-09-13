export function createLRUCache(maxEntries) {
  const cache = new Map();
  let head = null;
  let tail = null;
  let currentSize = 0;
  let stats = {
    hits: 0,
    misses: 0,
    evictions: 0,
    currentSize: 0,
    entryCount: 0,
  };
  // Helper to calculate approximate size in bytes
  function calculateSize(value) {
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
  function moveToHead(node) {
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
  function removeNode(node) {
    if (node.prev) node.prev.next = node.next;
    if (node.next) node.next.prev = node.prev;
    if (node === head) head = node.next;
    if (node === tail) tail = node.prev;
  }
  // Evict least recently used
  function evictLRU() {
    if (!tail) return;
    const node = tail;
    removeNode(node);
    cache.delete(node.key);
    currentSize -= node.entry.size;
    stats.evictions++;
    stats.entryCount--;
  }
  // Check if entry is expired
  function isExpired(entry) {
    return Date.now() > entry.expiresAt;
  }
  return {
    get(key) {
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
    set(key, value, ttlSeconds) {
      const size = calculateSize(value);
      const now = Date.now();
      const entry = {
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
      const node = {
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
    delete(key) {
      const node = cache.get(key);
      if (!node) return false;
      removeNode(node);
      cache.delete(key);
      currentSize -= node.entry.size;
      stats.entryCount--;
      return true;
    },
    deletePattern(pattern) {
      // Pattern matching for selective deletion
      // Convert wildcard pattern to regex (e.g., "pod-streams:test:*" -> "^pod-streams:test:.*$")
      const regex = new RegExp(
        "^" + pattern.replace(/\*/g, ".*").replace(/\?/g, ".") + "$",
      );
      const keysToDelete = [];
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
    clear(pattern) {
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
    getStats() {
      return {
        ...stats,
        currentSize,
      };
    },
    checkSize(value) {
      return calculateSize(value);
    },
  };
}
//# sourceMappingURL=lru-cache.js.map
