/**
 * Frontend upload queue with configurable concurrency limit.
 * Prevents saturating Supabase Storage API / browser connection limits
 * when many uploads are triggered simultaneously (e.g. agency bulk portfolio).
 */

type QueuedTask<T> = {
  task: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
};

class UploadQueue {
  private readonly maxConcurrent: number;
  private running = 0;
  private queue: QueuedTask<unknown>[] = [];

  constructor(maxConcurrent = 3) {
    this.maxConcurrent = maxConcurrent;
  }

  enqueue<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({ task, resolve, reject } as QueuedTask<unknown>);
      this.flush();
    });
  }

  get pending(): number {
    return this.queue.length;
  }

  get active(): number {
    return this.running;
  }

  private flush(): void {
    while (this.running < this.maxConcurrent && this.queue.length > 0) {
      const item = this.queue.shift()!;
      this.running++;
      item
        .task()
        .then(item.resolve, item.reject)
        .finally(() => {
          this.running--;
          this.flush();
        });
    }
  }
}

export const storageUploadQueue = new UploadQueue(3);
