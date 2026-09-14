// Structured API errors.

export interface APIErrorEntry {
  detail: string
  location: string
}

const STATUS_TEXTS: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  405: 'Method Not Allowed',
  409: 'Conflict',
  412: 'Precondition Failed',
  415: 'Unsupported Media Type',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  501: 'Not Implemented',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
  504: 'Gateway Timeout',
}

export class APIError extends Error {
  readonly status: number
  readonly title?: string
  readonly detail?: string
  readonly entries?: APIErrorEntry[]

  constructor(
    status: number,
    message: string,
    title?: string,
    detail?: string,
    entries?: APIErrorEntry[],
  ) {
    super(`${APIError.statusText(status)}: ${message}`)
    this.name = 'APIError'
    this.status = status
    this.title = title
    this.detail = detail
    this.entries = entries
  }

  static statusText(status: number): string {
    return STATUS_TEXTS[status] ?? `HTTP error ${status}`
  }

  static isNotFound(e: unknown): e is APIError {
    return e instanceof APIError && e.status === 404
  }

  static isConflict(e: unknown): e is APIError {
    return e instanceof APIError && e.status === 409
  }
}
