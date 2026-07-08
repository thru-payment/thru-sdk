/** Base class for every error thrown by the thru SDK. */
export class ThruError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = 'ThruError';
    if (options?.cause !== undefined) {
      (this as { cause?: unknown }).cause = options.cause;
    }
  }
}

/** The API responded with a non-2xx status. */
export class ThruAPIError extends ThruError {
  /** HTTP status code. */
  readonly status: number;
  /** Machine-readable error code from the API body, when present. */
  readonly code?: string;
  /** The `x-request-id` response header, for support. */
  readonly requestId?: string | null;
  /** The parsed error body, if any. */
  readonly body?: unknown;

  constructor(params: {
    message: string;
    status: number;
    code?: string;
    requestId?: string | null;
    body?: unknown;
  }) {
    super(params.message);
    this.name = 'ThruAPIError';
    this.status = params.status;
    this.code = params.code;
    this.requestId = params.requestId;
    this.body = params.body;
  }

  /** Build the most specific error subclass for a status + body. */
  static from(status: number, body: unknown, requestId?: string | null): ThruAPIError {
    const record = (body ?? {}) as Record<string, unknown>;
    const message =
      pickString(record['message']) ??
      pickString(record['error']) ??
      `thru: request failed with status ${status}`;
    const code = pickString(record['code']) ?? pickString(record['error']);
    const params = { message, status, code, requestId, body };

    if (status === 400 || status === 422) return new ThruValidationError(params);
    if (status === 401 || status === 403) return new ThruAuthError(params);
    if (status === 404) return new ThruNotFoundError(params);
    if (status === 409) return new ThruConflictError(params);
    if (status === 429) return new ThruRateLimitError(params);
    return new ThruAPIError(params);
  }
}

/** 400 / 422 — the request was rejected as invalid. */
export class ThruValidationError extends ThruAPIError {
  constructor(params: ConstructorParameters<typeof ThruAPIError>[0]) {
    super(params);
    this.name = 'ThruValidationError';
  }
}

/** 401 / 403 — missing or insufficient credentials. */
export class ThruAuthError extends ThruAPIError {
  constructor(params: ConstructorParameters<typeof ThruAPIError>[0]) {
    super(params);
    this.name = 'ThruAuthError';
  }
}

/** 404 — the resource does not exist. */
export class ThruNotFoundError extends ThruAPIError {
  constructor(params: ConstructorParameters<typeof ThruAPIError>[0]) {
    super(params);
    this.name = 'ThruNotFoundError';
  }
}

/** 409 — the request conflicts with the current state (e.g. already refunded). */
export class ThruConflictError extends ThruAPIError {
  constructor(params: ConstructorParameters<typeof ThruAPIError>[0]) {
    super(params);
    this.name = 'ThruConflictError';
  }
}

/** 429 — rate limited. */
export class ThruRateLimitError extends ThruAPIError {
  constructor(params: ConstructorParameters<typeof ThruAPIError>[0]) {
    super(params);
    this.name = 'ThruRateLimitError';
  }
}

/** The request timed out or the network failed. */
export class ThruConnectionError extends ThruError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'ThruConnectionError';
  }
}

function pickString(value: unknown): string | undefined {
  if (typeof value === 'string' && value.length > 0) return value;
  if (Array.isArray(value)) {
    const first = value.find((v) => typeof v === 'string');
    if (typeof first === 'string') return first;
  }
  return undefined;
}
