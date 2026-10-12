import { CommunityError } from "./community-validation.ts";

export class MediaCacheBusyError extends CommunityError {
  constructor() {
    super("Изображения обрабатываются. Попробуйте ещё раз.", 503);
  }
}
const removed = () => new CommunityError("Изображение недоступно", 404);
interface Job {
  promise: Promise<Buffer>;
  invalidated: boolean;
  readers: number;
}

// Per process, across cache directories. Two Sharp pipelines leave capacity
// for normal requests; at most 32 distinct cold keys wait for a slot. Warm
// reads bypass this queue. Sharing is bounded too (64 readers per key).
export function createMediaBuildQueue(concurrency = 2, maxPending = 32) {
  const jobs = new Map<string, Job>();
  const waiting: (() => void)[] = [];
  let running = 0;
  async function slot() {
    if (running < concurrency) {
      running++;
      return;
    }
    if (waiting.length >= maxPending) throw new MediaCacheBusyError();
    await new Promise<void>((resolve) => waiting.push(resolve));
  }
  function release() {
    const next = waiting.shift();
    if (next) next();
    else running--;
  }
  return {
    invalidate(key: string) {
      const job = jobs.get(key);
      if (job) job.invalidated = true;
    },
    async run(
      key: string,
      build: (invalidated: () => boolean) => Promise<Buffer>,
    ) {
      let job = jobs.get(key);
      if (!job) {
        // Admit synchronously, before a Promise can grow the in-flight map.
        if (jobs.size >= concurrency + maxPending)
          throw new MediaCacheBusyError();
        job = {
          promise: Promise.resolve(Buffer.alloc(0)),
          invalidated: false,
          readers: 0,
        };
        const current = job;
        jobs.set(key, current);
        current.promise = (async () => {
          await slot();
          try {
            if (current.invalidated) throw removed();
            const bytes = await build(() => current.invalidated);
            if (current.invalidated) throw removed();
            return bytes;
          } finally {
            release();
          }
        })().finally(() => jobs.delete(key));
      }
      if (job.invalidated) throw removed();
      if (job.readers >= 64) throw new MediaCacheBusyError();
      job.readers++;
      try {
        return await job.promise;
      } finally {
        job.readers--;
      }
    },
  };
}
