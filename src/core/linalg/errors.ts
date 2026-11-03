/** Thrown when a matrix that should be symmetric positive definite is not. */
export class NotPositiveDefiniteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotPositiveDefiniteError';
  }
}
