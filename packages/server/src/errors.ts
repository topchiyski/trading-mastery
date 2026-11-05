/** An error with an HTTP status and a stable machine-readable code. */
export class DomainError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

export const notFound = (what: string, id: number | string) =>
  new DomainError(404, 'NOT_FOUND', `${what} ${id} not found`);

export const invalid = (message: string, details?: unknown) =>
  new DomainError(400, 'VALIDATION_ERROR', message, details);

export const conflict = (code: string, message: string, details?: unknown) =>
  new DomainError(409, code, message, details);

/** True for SQLite UNIQUE violations, whether raw or wrapped by Drizzle. */
export function isUniqueViolation(err: unknown): boolean {
  for (let e: unknown = err; e && typeof e === 'object'; e = (e as { cause?: unknown }).cause) {
    const code = (e as { code?: unknown }).code;
    if (code === 'SQLITE_CONSTRAINT_UNIQUE' || code === 'SQLITE_CONSTRAINT_PRIMARYKEY') return true;
  }
  return false;
}

/** A partial update where every field may also be explicitly undefined (= leave unchanged). */
export type Patch<T> = { [K in keyof T]?: T[K] | undefined };
