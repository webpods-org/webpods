import type { CacheEntry, CacheStats } from "../types.js";

type LRUNode<T> = {
  key: string;
  entry: CacheEntry<T>;
  prev: LRUNode<T> | null;
  next: LRUNode<T> | null;
};

// Hierarchical node structure for O(1) pattern deletion
type HierarchicalNode<T> = {
  // For leaf nodes (actual cache entries)
  lruNode?: LRUNode<T>;
  // For branch nodes (path segments)
  children?: Map<string, HierarchicalNode<T>>;
  // Track if this is a leaf with data
  isLeaf?: boolean;
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

export function createHierarchicalLRUCache<T>(maxEntries: number): LRUCache<T> {
  // Hierarchical storage - root of the tree
  const root: HierarchicalNode<T> = { children: new Map() };

  // Flat map for O(1) direct key lookups (points to LRU nodes)
  const flatCache = new Map<string, LRUNode<T>>();

  // LRU linked list
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

  // Helper to parse key into segments
  function parseKey(key: string): string[] {
    // Split on colon delimiter
    return key.split(":");
  }

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

  // Remove node from LRU list
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
    const key = node.key;

    // Remove from hierarchical structure
    removeFromHierarchy(key);

    // Remove from flat cache
    flatCache.delete(key);

    // Remove from LRU list
    removeNode(node);

    currentSize -= node.entry.size;
    stats.evictions++;
    stats.entryCount--;
  }

  // Check if entry is expired
  function isExpired(entry: CacheEntry<T>): boolean {
    return Date.now() > entry.expiresAt;
  }

  // Navigate to a node in the hierarchy, creating path if needed
  function navigateToNode(
    segments: string[],
    createPath: boolean,
  ): HierarchicalNode<T> | null {
    let current = root;

    for (const segment of segments) {
      if (!current.children) {
        if (!createPath) return null;
        current.children = new Map();
      }

      let next = current.children.get(segment);
      if (!next) {
        if (!createPath) return null;
        next = { children: new Map() };
        current.children.set(segment, next);
      }

      current = next;
    }

    return current;
  }

  // Add to hierarchical structure
  function addToHierarchy(key: string, lruNode: LRUNode<T>): void {
    const segments = parseKey(key);
    const node = navigateToNode(segments, true);
    if (node) {
      node.lruNode = lruNode;
      node.isLeaf = true;
    }
  }

  // Remove from hierarchical structure
  function removeFromHierarchy(key: string): void {
    const segments = parseKey(key);
    const path: Array<{ parent: HierarchicalNode<T>; segment: string }> = [];
    let current = root;

    // Navigate to the node, tracking the path
    for (const segment of segments) {
      if (!current.children) return;
      const next = current.children.get(segment);
      if (!next) return;
      path.push({ parent: current, segment });
      current = next;
    }

    // Clear the leaf node
    current.lruNode = undefined;
    current.isLeaf = false;

    // Clean up empty parent nodes (going backwards)
    for (let i = path.length - 1; i >= 0; i--) {
      const item = path[i];
      if (!item) continue;

      const { parent, segment } = item;
      const node = parent.children?.get(segment);

      // Remove if node has no children and is not a leaf
      if (
        node &&
        !node.isLeaf &&
        (!node.children || node.children.size === 0)
      ) {
        parent.children?.delete(segment);
      } else {
        break; // Stop if we hit a non-empty node
      }
    }
  }

  // Delete all entries under a branch (for pattern deletion)
  function deleteSubtree(
    node: HierarchicalNode<T>,
    deletedNodes: LRUNode<T>[],
  ): void {
    // If this is a leaf, collect it for deletion
    if (node.isLeaf && node.lruNode) {
      deletedNodes.push(node.lruNode);
    }

    // Recursively delete all children
    if (node.children) {
      for (const child of node.children.values()) {
        deleteSubtree(child, deletedNodes);
      }
    }
  }

  // Parse pattern and find the branch to delete
  function parsePattern(pattern: string): {
    segments: string[];
    hasWildcard: boolean;
  } {
    // Remove trailing wildcards
    const cleanPattern = pattern.replace(/:\*$/, "");
    const segments = cleanPattern.split(":");
    const hasWildcard = pattern.endsWith("*");

    return { segments, hasWildcard };
  }

  return {
    get(key: string): T | null {
      const node = flatCache.get(key);
      if (!node) {
        stats.misses++;
        return null;
      }

      // Check expiration
      if (isExpired(node.entry)) {
        removeFromHierarchy(key);
        flatCache.delete(key);
        removeNode(node);
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
      const existingNode = flatCache.get(key);
      if (existingNode) {
        currentSize -= existingNode.entry.size;
        existingNode.entry = entry;
        currentSize += size;
        moveToHead(existingNode);
        return;
      }

      // Evict if at capacity
      while (flatCache.size >= maxEntries && tail) {
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

      // Add to both structures
      flatCache.set(key, node);
      addToHierarchy(key, node);

      currentSize += size;
      stats.entryCount++;
    },

    delete(key: string): boolean {
      const node = flatCache.get(key);
      if (!node) return false;

      // Remove from hierarchical structure
      removeFromHierarchy(key);

      // Remove from flat cache
      flatCache.delete(key);

      // Remove from LRU list
      removeNode(node);

      currentSize -= node.entry.size;
      stats.entryCount--;
      return true;
    },

    deletePattern(pattern: string): number {
      const { segments, hasWildcard } = parsePattern(pattern);

      // If no wildcard, it's a single key deletion
      if (!hasWildcard) {
        return this.delete(pattern) ? 1 : 0;
      }

      // Navigate to the branch node
      const branchNode = navigateToNode(segments, false);
      if (!branchNode || !branchNode.children) {
        return 0; // No matching branch found
      }

      // Collect all nodes to delete
      const nodesToDelete: LRUNode<T>[] = [];

      // Delete the entire subtree
      for (const child of branchNode.children.values()) {
        deleteSubtree(child, nodesToDelete);
      }

      // Clear the branch's children
      branchNode.children.clear();

      // Now remove all collected nodes from flat cache and LRU list
      for (const node of nodesToDelete) {
        flatCache.delete(node.key);
        removeNode(node);
        currentSize -= node.entry.size;
        stats.entryCount--;
      }

      return nodesToDelete.length;
    },

    clear(pattern?: string): void {
      if (!pattern) {
        // Clear everything
        flatCache.clear();
        root.children?.clear();
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
