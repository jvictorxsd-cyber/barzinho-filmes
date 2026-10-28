export type MediaType = 'movie' | 'tv';
export type LibraryStatus = 'watchlist' | 'watching' | 'completed' | 'dropped';
export interface Title {
  id: string;
  externalId: number;
  mediaType: MediaType;
  title: string;
  originalTitle?: string;
  overview: string;
  posterPath: string | null;
  backdropPath: string | null;
  releaseDate: string | null;
  runtime: number | null;
  genres: string[];
  voteAverage: number | null;
}
export interface User {
  id: string;
  username: string;
  displayName: string;
  email?: string;
  bio?: string;
  privateProfile?: boolean;
  emailVerifiedAt?: string | null;
}
export interface Credit { personId: number; name: string; character: string; profilePath: string | null }
export interface Season { id: number; seasonNumber: number; name: string; episodeCount: number; posterPath: string | null }
export interface TitleDetail extends Title {
  cast: Credit[];
  seasons?: Season[];
  trailer: null | {key: string; name: string; url: string};
  similar: Title[];
}
export interface Episode {
  id: string;
  titleId: string;
  seasonNumber: number;
  episodeNumber: number;
  title: string;
  overview: string;
  stillPath: string | null;
  airDate: string | null;
  runtime: number | null;
  voteAverage: number | null;
}
export interface HomeCatalog { trending: Title[]; upcoming: Title[]; topRated: Title[]; recent: Title[] }
export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); this.name = 'ApiError'; }
}
export interface ApiClientOptions {
  baseUrl: string;
  getToken?: () => Promise<string | null> | string | null;
  fetcher?: typeof fetch;
  credentials?: RequestCredentials;
}
/** Shared browser/native HTTP client. Credentials remain in caller-provided secure storage. */
export function createApiClient(options: ApiClientOptions) {
  const baseUrl = options.baseUrl.replace(/\/$/, '');
  return async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    if (!path.startsWith('/api/')) throw new Error('O caminho da API deve começar com /api/.');
    const token = await options.getToken?.();
    const headers = new Headers(init.headers);
    headers.set('Accept', 'application/json');
    if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    if (token) headers.set('Authorization', `Bearer ${token}`);
    let response: Response;
    // React Native's AbortSignal polyfill has no static timeout() method.
    const controller = init.signal ? null : new AbortController();
    const timeout = controller ? setTimeout(() => controller.abort(), 20000) : null;
    try {
      response = await (options.fetcher ?? fetch)(`${baseUrl}${path}`, {
        ...init, headers, credentials: options.credentials ?? 'include', signal: init.signal ?? controller!.signal,
      });
    } catch (error) {
      if (init.signal?.aborted) throw error;
      throw new ApiError(0, 'NETWORK_ERROR', 'Não foi possível conectar. Confira sua conexão e tente novamente.');
    } finally {
      if (timeout !== null) clearTimeout(timeout);
    }
    const body = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) {
      const nested = typeof body.error === 'object' && body.error !== null ? body.error as Record<string, unknown> : body;
      throw new ApiError(response.status, String(nested.code ?? body.code ?? 'API_ERROR'),
        typeof nested.message === 'string' ? nested.message : typeof body.error === 'string' ? body.error : 'Não foi possível concluir esta ação.');
    }
    return body as T;
  };
}
export function imageUrl(path: string | null | undefined, size: 'w342' | 'w780' | 'original' = 'w342') {
  return path && /^\/[\w.\/-]+$/.test(path) ? `https://image.tmdb.org/t/p/${size}${path}` : null;
}
export function validRating(score: number): boolean {
  return Number.isFinite(score) && score >= 0 && score <= 10 && Number.isInteger(score * 2);
}
