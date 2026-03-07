/**
 * AppError — a typed application error with an HTTP status code and a machine-readable code.
 *
 * Throw this anywhere in your routes or services. The global exception handler in
 * bootstrap/app.ts catches it and turns it into a structured JSON response automatically.
 *
 * @example
 *   throw new AppError('User not found.', 404, 'USER_NOT_FOUND')
 */
export class AppError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number = 500,
    public readonly code: string = 'APP_ERROR',
  ) {
    super(message)
    this.name = 'AppError'
  }

  toJSON() {
    return {
      error:   this.code,
      message: this.message,
    }
  }
}
