import {proxyFetch} from './network.js';
import type { FastifyInstance, FastifyReply } from 'fastify';

export interface CatalogDatabase {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
}
type Raw = Record<string, any>;
type CatalogTitle = ReturnType<typeof normalizeTitle>;
const API = 'https://api.themoviedb.org/3';
const TTL = 6 * 60 * 60 * 1000;
const STALE_LIMIT = 7 * 24 * 60 * 60 * 1000;

export class CatalogError extends Error {
  constructor(public code: string, message: string, public statusCode = 503) { super(message); }
}

export function catalogConfigured(): boolean {
  return Boolean(process.env.TMDB_TOKEN?.trim() || process.env.TMDB_API_KEY?.trim());
}

/** Credentials stay in the server request and are never part of cache keys or responses. */
export function createTmdbClient(db: CatalogDatabase, request: typeof fetch = proxyFetch) {
  const inflight = new Map<string, Promise<{ data: Raw; stale: boolean }>>();
  async function load(path: string, params: Record<string, string> = {}): Promise<{ data: Raw; stale: boolean }> {
    const query = new URLSearchParams({ language: 'pt-BR', ...params });
    query.sort();
    const key = `${path}?${query}`;
    const existing = inflight.get(key);
    if (existing) return existing;
    const operation = (async () => {
      const [cached] = await db.query<{ data: Raw; updated_at: Date | string }>(
        'SELECT data, updated_at FROM catalog_cache WHERE cache_key = $1', [key]);
      const age = cached ? Date.now() - new Date(cached.updated_at).getTime() : Infinity;
      if (cached && age < TTL) return { data: cached.data, stale: false };
      if (!catalogConfigured()) {
        if (cached && age < STALE_LIMIT) return { data: cached.data, stale: true };
        throw new CatalogError('CATALOG_NOT_CONFIGURED', 'O catálogo aguarda a configuração segura da integração TMDB.');
      }
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (process.env.TMDB_TOKEN) headers.Authorization = `Bearer ${process.env.TMDB_TOKEN}`;
      else query.set('api_key', process.env.TMDB_API_KEY!);
      let data: Raw;
      try {
        const response = await request(`${API}${path}?${query}`, { headers, signal: AbortSignal.timeout(12_000) });
        if (response.status === 404) throw new CatalogError('CATALOG_NOT_FOUND', 'Título ou episódio não encontrado.', 404);
        if (response.status === 401 || response.status === 403) throw new CatalogError('CATALOG_CREDENTIALS_INVALID', 'A integração TMDB precisa de uma credencial válida.');
        if (response.status === 429) throw new CatalogError('CATALOG_RATE_LIMITED', 'O catálogo está recebendo muitas solicitações. Tente novamente em instantes.');
        if (!response.ok) throw new CatalogError('CATALOG_UNAVAILABLE', 'O catálogo está temporariamente indisponível.');
        data = await response.json() as Raw;
      } catch (error) {
        if (cached && age < STALE_LIMIT && !(error instanceof CatalogError && error.statusCode === 404)) return { data: cached.data, stale: true };
        if (error instanceof CatalogError) throw error;
        throw new CatalogError('CATALOG_UNAVAILABLE', 'Não foi possível consultar o catálogo agora. Tente novamente em instantes.');
      }
      await db.query('INSERT INTO catalog_cache (cache_key, data, updated_at) VALUES ($1, $2::jsonb, NOW()) ON CONFLICT (cache_key) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()', [key, JSON.stringify(data)]);
      return { data, stale: false };
    })();
    inflight.set(key, operation);
    try { return await operation; } finally { inflight.delete(key); }
  }
  return load;
}

export function normalizeTitle(raw: Raw, explicitType?: string) {
  const mediaType = explicitType || raw.media_type || (raw.first_air_date !== undefined ? 'tv' : 'movie');
  return {
    id: `${mediaType}:${raw.id}`, externalId: raw.id as number, mediaType,
    title: String(raw.title || raw.name || ''), originalTitle: String(raw.original_title || raw.original_name || ''),
    overview: String(raw.overview || ''), posterPath: raw.poster_path || null, backdropPath: raw.backdrop_path || null,
    releaseDate: raw.release_date || raw.first_air_date || null,
    runtime: raw.runtime || raw.episode_run_time?.[0] || null,
    genres: (raw.genres || []).map((genre: Raw) => String(genre.name)),
    voteAverage: typeof raw.vote_average === 'number' ? raw.vote_average : null,
    voteCount: raw.vote_count || 0,
  };
}
function normalizeCast(raw: Raw) {
  return { personId: raw.id, name: raw.name || raw.original_name || '', character: raw.character || '', profilePath: raw.profile_path || null };
}
function normalizeCrew(raw: Raw) {
  return { personId: raw.id, name: raw.name || '', job: raw.job || '', department: raw.department || '', profilePath: raw.profile_path || null };
}
function normalizeEpisode(raw: Raw, tvId: number, season: number) {
  return {
    id: `tv:${tvId}:${season}:${raw.episode_number}`, titleId: `tv:${tvId}`, externalId: raw.id,
    seasonNumber: season, episodeNumber: raw.episode_number, title: raw.name || '', overview: raw.overview || '',
    stillPath: raw.still_path || null, airDate: raw.air_date || null, runtime: raw.runtime || null,
    voteAverage: typeof raw.vote_average === 'number' ? raw.vote_average : null,
    voteCount: raw.vote_count || 0,
  };
}
function validNumber(value: unknown, allowZero = false) {
  if (typeof value !== 'string' || !/^\d{1,9}$/.test(value) || Number(value) < (allowZero ? 0 : 1)) {
    throw new CatalogError('INVALID_PARAMETER', 'Identificador inválido.', 400);
  }
  return Number(value);
}
function titleType(value: string): 'movie' | 'tv' {
  if (value !== 'movie' && value !== 'tv') throw new CatalogError('INVALID_PARAMETER', 'Tipo de produção inválido.', 400);
  return value;
}
function sendError(reply: FastifyReply, error: unknown) {
  if (error instanceof CatalogError) return reply.code(error.statusCode).send({ error: error.code, message: error.message });
  throw error;
}
async function saveTitles(db: CatalogDatabase, titles: CatalogTitle[]) {
  if (!titles.length) return;
  const unique = [...new Map(titles.filter(t => t.externalId && ['movie', 'tv'].includes(t.mediaType)).map(t => [t.id, t])).values()];
  await db.query(`INSERT INTO catalog_titles (id, media_type, external_id, title, poster_path, backdrop_path, overview, release_date, runtime, genres, data, updated_at)
    SELECT x->>'id', x->>'mediaType', (x->>'externalId')::integer, x->>'title', x->>'posterPath', x->>'backdropPath', x->>'overview', x->>'releaseDate', (x->>'runtime')::integer, x->'genres', x, NOW()
    FROM jsonb_array_elements($1::jsonb) x
    ON CONFLICT (id) DO UPDATE SET title=EXCLUDED.title, poster_path=EXCLUDED.poster_path, backdrop_path=EXCLUDED.backdrop_path, overview=EXCLUDED.overview, release_date=EXCLUDED.release_date, runtime=COALESCE(EXCLUDED.runtime,catalog_titles.runtime), genres=CASE WHEN jsonb_array_length(EXCLUDED.genres)>0 THEN EXCLUDED.genres ELSE catalog_titles.genres END, data=catalog_titles.data || jsonb_strip_nulls(EXCLUDED.data) || jsonb_build_object('runtime',COALESCE(EXCLUDED.runtime,catalog_titles.runtime),'genres',CASE WHEN jsonb_array_length(EXCLUDED.genres)>0 THEN EXCLUDED.genres ELSE catalog_titles.genres END), updated_at=NOW()`, [JSON.stringify(unique)]);
}
async function saveEpisodes(db: CatalogDatabase, episodes: Raw[]) {
  if (!episodes.length) return;
  await db.query(`INSERT INTO catalog_episodes (id,title_id,season_number,episode_number,title,runtime,data)
    SELECT x->>'id',x->>'titleId',(x->>'seasonNumber')::integer,(x->>'episodeNumber')::integer,x->>'title',(x->>'runtime')::integer,x
    FROM jsonb_array_elements($1::jsonb) x
    ON CONFLICT (id) DO UPDATE SET title=EXCLUDED.title,runtime=EXCLUDED.runtime,data=catalog_episodes.data || EXCLUDED.data`, [JSON.stringify(episodes)]);
}

const clients = new WeakMap<object, ReturnType<typeof createTmdbClient>>();
function clientFor(db: CatalogDatabase) {
  let client = clients.get(db);
  if (!client) { client = createTmdbClient(db); clients.set(db, client); }
  return client;
}
async function getTitle(db: CatalogDatabase, type: 'movie' | 'tv', id: number) {
  const { data, stale } = await clientFor(db)(`/${type}/${id}`, {
    append_to_response: 'credits,videos,images,external_ids,recommendations,watch/providers,release_dates,content_ratings',
    include_image_language: 'pt,en,null',
  });
  const trailers = data.videos?.results || [];
  const trailer = trailers.find((video: Raw) => video.site === 'YouTube' && video.type === 'Trailer' && video.official && /^[\w-]{11}$/.test(video.key));
  const provider = data['watch/providers']?.results?.BR;
  const normalizeProviders = (items: Raw[] = []) => items.map(p => ({ id: p.provider_id, name: p.provider_name, logoPath: p.logo_path || null }));
  const brazilRelease = data.release_dates?.results?.find((item: Raw) => item.iso_3166_1 === 'BR');
  const certification = type === 'movie' ? brazilRelease?.release_dates?.find((item: Raw) => item.certification)?.certification : data.content_ratings?.results?.find((item: Raw) => item.iso_3166_1 === 'BR')?.rating;
  const title = {
    ...normalizeTitle(data, type), status: data.status || null,
    seasons: (data.seasons || []).map((season: Raw) => ({ id: season.id, seasonNumber: season.season_number, name: season.name, overview: season.overview || '', posterPath: season.poster_path || null, airDate: season.air_date || null, episodeCount: season.episode_count || 0 })),
    numberOfSeasons: data.number_of_seasons || 0, numberOfEpisodes: data.number_of_episodes || 0,
    cast: (data.credits?.cast || []).map(normalizeCast), crew: (data.credits?.crew || []).map(normalizeCrew),
    trailer: trailer ? { key: trailer.key, name: trailer.name, url: `https://www.youtube.com/watch?v=${trailer.key}` } : null,
    images: (data.images?.backdrops || []).slice(0, 20).map((img: Raw) => ({ filePath: img.file_path, aspectRatio: img.aspect_ratio })),
    providers: { link: provider?.link || null, flatrate: normalizeProviders(provider?.flatrate), rent: normalizeProviders(provider?.rent), buy: normalizeProviders(provider?.buy), attribution: 'Disponibilidade fornecida pelo JustWatch via TMDB.' },
    similar: (data.recommendations?.results || []).slice(0, 20).map((item: Raw) => normalizeTitle(item, type)),
    imdbId: data.imdb_id || data.external_ids?.imdb_id || null,
    certification: certification || null, countries: (data.production_countries || []).map((c: Raw) => c.name),
    languages: (data.spoken_languages || []).map((l: Raw) => l.name || l.english_name),
    productionCompanies: (data.production_companies || []).map((company: Raw) => ({ id: company.id, name: company.name, logoPath: company.logo_path || null })),
    nextEpisode: data.next_episode_to_air ? normalizeEpisode(data.next_episode_to_air, id, data.next_episode_to_air.season_number) : null,
    source: { name: 'TMDB', stale },
  };
  await saveTitles(db, [title, ...title.similar]);
  return title;
}
async function getEpisode(db: CatalogDatabase, tvId: number, season: number, episode: number) {
  const [titleExists] = await db.query('SELECT id FROM catalog_titles WHERE id=$1', [`tv:${tvId}`]);
  if (!titleExists) await getTitle(db, 'tv', tvId);
  const { data, stale } = await clientFor(db)(`/tv/${tvId}/season/${season}/episode/${episode}`, { append_to_response: 'credits' });
  // Only episode credits are eligible. A show's general cast is deliberately never substituted.
  const participation = [...(data.credits?.cast || []), ...(data.credits?.guest_stars || [])];
  const cast = [...new Map(participation.map((p: Raw) => [`${p.id}:${p.character || ''}`, normalizeCast(p)])).values()];
  const result = { ...normalizeEpisode(data, tvId, season), cast, crew: (data.credits?.crew || data.crew || []).map(normalizeCrew), source: { name: 'TMDB', stale } };
  await saveEpisodes(db, [result]);
  return result;
}

export async function getEpisodeCharacters(db: CatalogDatabase, episodeId: string): Promise<Array<{ personId: number; name: string; character: string; profilePath?: string | null }>> {
  const match = /^tv:(\d{1,9}):(\d{1,9}):(\d{1,9})$/.exec(episodeId);
  if (!match) throw new CatalogError('INVALID_PARAMETER', 'Episódio inválido.', 400);
  const [episode] = await db.query<{ data: Raw }>('SELECT data FROM catalog_episodes WHERE id=$1', [episodeId]);
  if (Array.isArray(episode?.data?.cast)) return episode.data.cast;
  return (await getEpisode(db, Number(match[1]), Number(match[2]), Number(match[3]))).cast;
}

export async function registerCatalog(app: FastifyInstance, db: CatalogDatabase) {
  const tmdb = clientFor(db);
  app.get('/api/catalog/status', async () => ({ configured: catalogConfigured(), source: 'TMDB', attribution: 'Este produto utiliza a API do TMDB, mas não é endossado ou certificado pelo TMDB.' }));
  app.get('/api/catalog/home', async (_request, reply) => {
    try {
      const responses = await Promise.all([
        tmdb('/trending/all/day'), tmdb('/movie/upcoming', { region: 'BR' }),
        tmdb('/movie/top_rated', { region: 'BR' }), tmdb('/movie/now_playing', { region: 'BR' }),
      ]);
      const lists = responses.map(({ data }, i) => (data.results || []).filter((t: Raw) => i !== 0 || ['movie', 'tv'].includes(t.media_type)).map((t: Raw) => normalizeTitle(t, i === 0 ? undefined : 'movie')));
      await saveTitles(db, lists.flat());
      return { trending: lists[0], upcoming: lists[1], topRated: lists[2], recent: lists[3], source: { name: 'TMDB', stale: responses.some(r => r.stale) } };
    } catch (error) { return sendError(reply, error); }
  });
  app.get('/api/catalog/search', async (request, reply) => {
    try {
      const q = request.query as Record<string, string>;
      const type = q.type || 'multi';
      if (!['movie', 'tv', 'person', 'multi'].includes(type)) throw new CatalogError('INVALID_PARAMETER', 'Filtro de produção inválido.', 400);
      const page = q.page ? validNumber(q.page) : 1;
      if (page > 500 || (q.q?.length || 0) > 200) throw new CatalogError('INVALID_PARAMETER', 'Pesquisa inválida.', 400);
      const params: Record<string, string> = { page: String(page), include_adult: 'false' };
      const search = q.q?.trim();
      let path: string;
      if (search) { path = `/search/${type}`; params.query = search; }
      else if (type === 'movie' || type === 'tv') {
        path = `/discover/${type}`;
        params.sort_by = 'popularity.desc';
        if (q.genre) params.with_genres = String(validNumber(q.genre));
        if (q.year && /^\d{4}$/.test(q.year)) params[type === 'movie' ? 'primary_release_year' : 'first_air_date_year'] = q.year;
        if (q.minRating && Number(q.minRating) >= 0 && Number(q.minRating) <= 10) params['vote_average.gte'] = q.minRating;
        if (q.country && /^[A-Z]{2}$/.test(q.country)) params.with_origin_country = q.country;
        if (q.language && /^[a-z]{2}$/.test(q.language)) params.with_original_language = q.language;
        if (q.provider) { params.with_watch_providers = String(validNumber(q.provider)); params.watch_region = 'BR'; }
      } else { path = type === 'person' ? '/person/popular' : '/trending/all/day'; }
      const { data, stale } = await tmdb(path, params);
      const results = (data.results || []).map((raw: Raw) => raw.media_type === 'person' || type === 'person'
        ? { id: `person:${raw.id}`, externalId: raw.id, mediaType: 'person', name: raw.name, title: raw.name, profilePath: raw.profile_path || null, posterPath: raw.profile_path || null, knownForDepartment: raw.known_for_department || null }
        : normalizeTitle(raw, type === 'movie' || type === 'tv' ? type : undefined));
      await saveTitles(db, results.filter((r: Raw) => r.mediaType !== 'person'));
      return { results, page: data.page || page, totalPages: Math.min(data.total_pages || 1, 500), totalResults: data.total_results || results.length, source: { name: 'TMDB', stale } };
    } catch (error) { return sendError(reply, error); }
  });
  app.get('/api/catalog/genres', async (_request, reply) => {
    try {
      const [movie, tv] = await Promise.all([tmdb('/genre/movie/list'), tmdb('/genre/tv/list')]);
      return { movie: movie.data.genres, tv: tv.data.genres };
    } catch (error) { return sendError(reply, error); }
  });
  app.get('/api/catalog/person/:id', async (request, reply) => {
    try {
      const id = validNumber((request.params as Record<string, string>).id);
      const { data, stale } = await tmdb(`/person/${id}`, { append_to_response: 'combined_credits' });
      const credits: Raw[] = [...(data.combined_credits?.cast || []), ...(data.combined_credits?.crew || [])];
      const filmography = credits.filter(c => ['movie', 'tv'].includes(c.media_type)).map(c => ({ ...normalizeTitle(c), character: c.character || null, job: c.job || null })).sort((a, b) => (b.releaseDate || '').localeCompare(a.releaseDate || ''));
      await saveTitles(db, filmography);
      return { id: `person:${id}`, externalId: id, name: data.name, profilePath: data.profile_path || null, biography: data.biography || '', birthday: data.birthday || null, deathday: data.deathday || null, placeOfBirth: data.place_of_birth || null, knownForDepartment: data.known_for_department || null, filmography, source: { name: 'TMDB', stale } };
    } catch (error) { return sendError(reply, error); }
  });
  app.get('/api/catalog/tv/:id/seasons/:season', async (request, reply) => {
    try {
      const params = request.params as Record<string, string>;
      const id = validNumber(params.id), season = validNumber(params.season, true);
      const [existing] = await db.query('SELECT id FROM catalog_titles WHERE id=$1', [`tv:${id}`]);
      if (!existing) await getTitle(db, 'tv', id);
      const { data, stale } = await tmdb(`/tv/${id}/season/${season}`);
      const episodes = (data.episodes || []).map((ep: Raw) => normalizeEpisode(ep, id, season));
      await saveEpisodes(db, episodes);
      return { id: data.id, seasonNumber: season, name: data.name, overview: data.overview || '', posterPath: data.poster_path || null, episodes, source: { name: 'TMDB', stale } };
    } catch (error) { return sendError(reply, error); }
  });
  app.get('/api/catalog/tv/:id/seasons/:season/episodes/:episode', async (request, reply) => {
    try {
      const p = request.params as Record<string, string>;
      return await getEpisode(db, validNumber(p.id), validNumber(p.season, true), validNumber(p.episode));
    } catch (error) { return sendError(reply, error); }
  });
  app.get('/api/catalog/:type/:id', async (request, reply) => {
    try {
      const p = request.params as Record<string, string>;
      return await getTitle(db, titleType(p.type), validNumber(p.id));
    } catch (error) { return sendError(reply, error); }
  });
}
