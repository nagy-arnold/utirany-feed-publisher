export class ProviderError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ProviderError';
  }
}

export class QuotaExhaustedError extends ProviderError {
  constructor(message = 'MenetBrand daily API quota exceeded (ERROR_API_KEY_LIMIT_REACHED)') {
    super(message);
    this.name = 'QuotaExhaustedError';
  }
}

export class ProviderHttpError extends ProviderError {
  readonly status: number;
  readonly path: string;

  constructor(status: number, path: string) {
    super(`MenetBrand HTTP ${status} error at ${path}`);
    this.name = 'ProviderHttpError';
    this.status = status;
    this.path = path;
  }
}

export class ProviderNetworkError extends ProviderError {
  readonly path: string;

  constructor(path: string, cause?: unknown) {
    super(`Network error contacting MenetBrand at ${path}`, { cause });
    this.name = 'ProviderNetworkError';
    this.path = path;
  }
}

export class ProviderContractError extends ProviderError {
  constructor(message: string) {
    super(`MenetBrand contract violation: ${message}`);
    this.name = 'ProviderContractError';
  }
}
