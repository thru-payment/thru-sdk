import type { HttpClient } from './http';

/** Base class every resource module extends — holds the shared transport. */
export abstract class Resource {
  constructor(protected readonly http: HttpClient) {}
}
