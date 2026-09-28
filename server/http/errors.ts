// Only intentionally authored validation messages may cross the API boundary.
// Database/runtime errors propagate to the lifecycle's redacted 500 response.
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}
