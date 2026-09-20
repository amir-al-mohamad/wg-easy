/**
 * One writer at a time for the kernel state this feature owns.
 *
 * The apply pass, the re-resolve pass and the traffic pass all mutate the same
 * address sets, and an apply may destroy a set another pass is mid-way through
 * filling. Rather than reason about every interleaving, they take turns.
 */

let chain: Promise<void> = Promise.resolve();

export function withRoutingLock<T>(task: () => Promise<T>): Promise<T> {
  const run = chain.then(task);
  // Keep the chain alive past a failure; the caller still sees the rejection.
  chain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}
