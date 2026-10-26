import type {LibraryStatus} from '@barzinho/shared';

export type Request = <T>(path: string, init?: RequestInit) => Promise<T>;
export type LibraryEntry = {id: string; status: LibraryStatus; favorite: boolean};
export interface TrackingState {
  titleId: string | null;
  userId: string | null;
  ready: boolean;
  loading: boolean;
  busy: boolean;
  error: string;
  entry: LibraryEntry | null;
  myRating: number | null;
  watched: string[];
}
const empty = (): TrackingState => ({titleId:null,userId:null,ready:false,loading:false,busy:false,error:'',entry:null,myRating:null,watched:[]});

/** Owns one visible title. Late responses never cross titles or account boundaries. */
export function createTitleTracking(request: Request) {
  let state = empty();
  let revision = 0;
  let controller: AbortController | undefined;
  const listeners = new Set<() => void>();
  const publish = (patch: Partial<TrackingState>) => {
    state = {...state,...patch};
    listeners.forEach(listener => listener());
  };
  const isCurrent = (version: number) => revision === version;
  async function read(version: number) {
    const {titleId,userId} = state;
    if(!titleId || !userId) return;
    controller?.abort();
    controller = new AbortController();
    const signal = controller.signal;
    publish({loading:true,ready:false,error:''});
    try {
      const [library,rating,episodes] = await Promise.all([
        request<{items: LibraryEntry[]}>('/api/library',{signal}),
        request<{myRating: number | null}>(`/api/ratings?targetId=${encodeURIComponent(titleId)}`,{signal}),
        titleId.startsWith('tv:')
          ? request<{items: {episodeId: string}[]}>(`/api/watch/episodes/${encodeURIComponent(titleId)}`,{signal})
          : Promise.resolve({items:[]}),
      ]);
      if(isCurrent(version) && !signal.aborted) publish({entry:library.items.find(item => item.id === titleId) ?? null,myRating:rating.myRating,watched:episodes.items.map(item => item.episodeId),ready:true});
    } catch(error) {
      if(isCurrent(version) && !signal.aborted) publish({error:error instanceof Error ? error.message : 'Não foi possível sincronizar seu progresso.'});
    } finally {
      if(isCurrent(version) && !signal.aborted) publish({loading:false});
    }
  }
  async function mutate(path: string, body: unknown, method = 'PUT') {
    if(!state.ready || state.busy || !state.userId) return false;
    const version = revision;
    publish({busy:true,error:''});
    try {
      await request(path,{method,body:JSON.stringify(body)});
      if(!isCurrent(version)) return false;
      await read(version);
      return isCurrent(version) && state.ready;
    } catch(error) {
      // A lost response may follow a committed write: require reconciliation before retrying.
      if(isCurrent(version)) publish({ready:false,error:error instanceof Error ? error.message : 'Não foi possível salvar. Atualize os dados antes de tentar novamente.'});
      return false;
    } finally {
      if(isCurrent(version)) publish({busy:false});
    }
  }
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) {listeners.add(listener);return () => {listeners.delete(listener);};},
    async open(titleId: string, userId: string | null) {
      const version = ++revision;
      controller?.abort();
      state = empty();
      publish({titleId,userId});
      await read(version);
    },
    close() {++revision;controller?.abort();state=empty();publish({});},
    async refresh() {if(!state.busy) await read(++revision);},
    setStatus(status: LibraryStatus) {return mutate('/api/library',{titleId:state.titleId,status});},
    toggleFavorite() {return mutate('/api/library',{titleId:state.titleId,status:state.entry?.status ?? 'watchlist',favorite:!state.entry?.favorite});},
    rate(score: number) {return mutate('/api/ratings',{targetId:state.titleId,targetType:'title',score});},
    watch(episodeId: string) {
      if(!state.titleId || !episodeId.startsWith(`${state.titleId}:`)) return Promise.resolve(false);
      return mutate('/api/watch/episode',{episodeId,watched:!state.watched.includes(episodeId)});
    },
    markSeason(seasonNumber: number) {return mutate('/api/watch/season',{titleId:state.titleId,seasonNumber,confirmed:true});},
  };
}
