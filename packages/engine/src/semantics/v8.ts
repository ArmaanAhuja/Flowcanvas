// The heap's use and limit, behind an object of our own so tests can replace the reading (semantic-service.ts releases
// language services when the heap is high; an ES module's namespace can't be spied on).
import { getHeapStatistics } from 'node:v8';

export const heap = {
  /** Bytes in use, and the most the heap may grow to. */
  read: (): { used: number; limit: number } => {
    const statistics = getHeapStatistics();
    return { used: statistics.used_heap_size, limit: statistics.heap_size_limit };
  },
};
