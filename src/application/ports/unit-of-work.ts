export interface UnitOfWork<TContext> {
  // The callback receives repositories bound to the same transaction.
  run<TResult>(work: (context: TContext) => Promise<TResult>): Promise<TResult>;
}
