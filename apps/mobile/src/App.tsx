import React, {useEffect, useMemo, useRef, useState, useSyncExternalStore} from 'react';
import {ActivityIndicator, Alert, AppState, FlatList, Image, Linking, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View} from 'react-native';
import {SafeAreaProvider, SafeAreaView} from 'react-native-safe-area-context';
import {StatusBar} from 'expo-status-bar';
import * as SecureStore from 'expo-secure-store';
import {createApiClient, imageUrl, type HomeCatalog, type Title, type TitleDetail, type User, type Episode} from '@barzinho/shared';
import {createTitleTracking} from './title-tracking';
import {createMovieDiary} from './movie-diary';

const SESSION_KEY = 'barzinho.session';
const THEME_KEY = 'barzinho.theme';
const api = createApiClient({baseUrl: process.env.EXPO_PUBLIC_API_URL ?? 'https://barzinho-filmes.vercel.app', credentials: 'omit', getToken: () => SecureStore.getItemAsync(SESSION_KEY)});
const tabs = ['Início', 'Explorar', 'Calendário', 'Atividades', 'Perfil'] as const;
type Tab = typeof tabs[number];
type Activity = {id: string; type?: string; title?: string; createdAt?: string; created_at?: string; data?: Record<string, unknown>};
type Profile = {user: User; stats: Record<string, number>; activity: Activity[]; achievements: {code: string; name: string; description: string; earnedAt?: string; progress?: number; goal?: number}[]};
const dark = {bg:'#0c0d10',surface:'#17191e',line:'#2b2e37',text:'#f8f9fc',muted:'#a4a9b6',accent:'#ffe234',ink:'#111318'};
const light = {bg:'#f4f5f8',surface:'#ffffff',line:'#d9dce5',text:'#171921',muted:'#5e6474',accent:'#ffe234',ink:'#111318'};
const dateLabel = (date: string | null | undefined) => date ? new Date(date.length === 10 ? `${date}T12:00:00` : date).toLocaleDateString('pt-BR') : 'Data não informada';

export default function App() { return <SafeAreaProvider><Barzinho /></SafeAreaProvider>; }
function Barzinho() {
  const [tab,setTab] = useState<Tab>('Início');
  const [theme,setTheme] = useState<'dark'|'light'>('dark');
  const colors = theme === 'dark' ? dark : light;
  const [user,setUser] = useState<User|null>(null);
  const [home,setHome] = useState<HomeCatalog|null>(null);
  const [query,setQuery] = useState('');
  const [results,setResults] = useState<Title[]>([]);
  const [profile,setProfile] = useState<Profile|null>(null);
  const [feed,setFeed] = useState<Activity[]>([]);
  const [library,setLibrary] = useState<Title[]>([]);
  const [showLibrary,setShowLibrary] = useState(false);
  const [selected,setSelected] = useState<TitleDetail|null>(null);
  const [episodes,setEpisodes] = useState<Episode[]>([]);
  const tracking = useMemo(() => createTitleTracking(api),[]);
  const diary = useMemo(() => createMovieDiary(api,SecureStore),[]);
  const progress = useSyncExternalStore(tracking.subscribe,tracking.getSnapshot);
  const watched = new Set(progress.watched);
  const [selectedSeason,setSelectedSeason] = useState<number|null>(null);
  const detailVersion = useRef(0);
  const tabVersion = useRef(0);
  const [detailLoading,setDetailLoading] = useState(false);
  const [error,setError] = useState('');
  const [loading,setLoading] = useState(true);
  const [busy,setBusy] = useState(false);
  const [authMode,setAuthMode] = useState<'login'|'register'>('login');
  const [email,setEmail] = useState('');
  const [password,setPassword] = useState('');
  const [username,setUsername] = useState('');
  const [displayName,setDisplayName] = useState('');
  const [score,setScore] = useState(8);
  const [statusMessage,setStatusMessage] = useState('');
  const [sessionReady,setSessionReady] = useState(false);

  useEffect(() => {
    SecureStore.getItemAsync(THEME_KEY).then(value => {if(value === 'light') setTheme(value);}).catch(() => {});
    api<{user:User}>('/api/auth/me').then(data => setUser(data.user)).catch(() => {}).finally(() => setSessionReady(true));
  },[]);
  useEffect(() => { if(sessionReady) void loadTab(); },[tab,user?.id,sessionReady,showLibrary]);
  useEffect(() => {
    closeTitle(); setProfile(null); setLibrary([]); setFeed([]); setShowLibrary(false);
  },[user?.id]);
  useEffect(() => {
    const listener = AppState.addEventListener('change',state => {
      if(state === 'active' && sessionReady) {void loadTab();void tracking.refresh();}
    });
    return () => listener.remove();
  },[tab,user?.id,sessionReady,showLibrary]);
  useEffect(() => {setScore(progress.myRating ?? 8);},[progress.titleId,progress.myRating,progress.ready]);
  useEffect(() => () => {tracking.close();++detailVersion.current;++tabVersion.current;},[tracking]);
  useEffect(() => {
    if(tab !== 'Explorar') return;
    if(query.trim().length < 2) {setResults([]); return;}
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true); setError('');
      try { const data = await api<{results:Title[]}>(`/api/catalog/search?q=${encodeURIComponent(query.trim())}`,{signal:controller.signal}); setResults(data.results.filter(item => item.mediaType === 'movie' || item.mediaType === 'tv')); }
      catch(e) {if(!controller.signal.aborted) setError(message(e));}
      finally {if(!controller.signal.aborted) setLoading(false);}
    },350);
    return () => {clearTimeout(timer); controller.abort();};
  },[query,tab]);
  const message = (e:unknown) => e instanceof Error ? e.message : 'Não foi possível concluir esta ação.';
  async function loadTab() {
    const version = ++tabVersion.current;
    const current = () => version === tabVersion.current;
    setError(''); setLoading(true);
    try {
      if(tab === 'Início' || tab === 'Calendário') {const data = await api<HomeCatalog>('/api/catalog/home');if(current()) setHome(data);}
      if(tab === 'Atividades' && user) {const data = await api<{items:Activity[]}>('/api/feed');if(current()) setFeed(data.items);}
      if(tab === 'Perfil' && user) {
        const data = await api<Profile>('/api/profile');
        if(!current()) return;
        setProfile(data);
        if(showLibrary) {
          const data = await api<{items:Title[]}>('/api/library');
          if(current()) setLibrary(data.items.map(item => ({...item,externalId:Number(item.id.split(':')[1]),genres:item.genres ?? [],runtime:item.runtime ?? null,voteAverage:item.voteAverage ?? null})));
        }
      }
    } catch(e) { if(current()) setError(message(e)); } finally {if(current()) setLoading(false);}
  }
  function closeTitle() {
    ++detailVersion.current;tracking.close();setSelected(null);setEpisodes([]);setSelectedSeason(null);setStatusMessage('');setDetailLoading(false);
  }
  async function openTitle(item:Title) {
    closeTitle();
    const version = detailVersion.current;
    setDetailLoading(true);
    try {
      const detail = await api<TitleDetail>(`/api/catalog/${item.mediaType}/${item.externalId}`);
      if(version !== detailVersion.current) return;
      setSelected(detail);void tracking.open(detail.id,user?.id ?? null);
    } catch(e) {if(version === detailVersion.current) Alert.alert('Título indisponível',message(e));}
    finally {if(version === detailVersion.current) setDetailLoading(false);}
  }
  async function trackedAction(run:()=>Promise<boolean>,success:string) {
    if(!user) {closeTitle();setTab('Perfil');return;}
    const version = detailVersion.current;
    setStatusMessage('');
    if(await run() && version === detailVersion.current) {setStatusMessage(success);void loadTab();}
  }
  function confirmMovie() {
    if(!user) {closeTitle();setTab('Perfil');return;}
    if(!selected || !progress.ready) return;
    const titleId = selected.id;
    const userId = user.id;
    const version = detailVersion.current;
    Alert.alert('Registrar sessão de hoje?','Cada confirmação registra uma visualização. Use novamente quando reassistir ao filme.',[
      {text:'Cancelar',style:'cancel'},
      {text:'Registrar sessão',onPress:()=>void recordMovie(userId,titleId,version)},
    ]);
  }
  async function recordMovie(userId:string,titleId:string,version:number) {
    if(version !== detailVersion.current) return;
    setBusy(true);setStatusMessage('');
    try {
      const result = await diary.record(userId,titleId);
      if(result && version === detailVersion.current) {
        setStatusMessage(result.created?'Sessão registrada no seu diário.':'A sessão anterior foi confirmada, sem duplicação.');
        await tracking.refresh();void loadTab();
      }
    } catch(e) {if(version === detailVersion.current) Alert.alert('Não foi possível confirmar a sessão',`${message(e)} Tente novamente para confirmar o mesmo registro.`);}
    finally {setBusy(false);}
  }
  async function authenticate() {
    setBusy(true); setError('');
    try {
      const result = await api<{user:User;token:string}>(`/api/auth/${authMode}`,{method:'POST',body:JSON.stringify({email,password,...(authMode === 'register' ? {username,displayName} : {})})});
      await SecureStore.setItemAsync(SESSION_KEY,result.token); setUser(result.user); setPassword('');
    } catch(e) {setError(message(e));} finally {setBusy(false);}
  }
  async function logout() {
    setBusy(true);
    try {await api('/api/auth/logout',{method:'POST'}); await SecureStore.deleteItemAsync(SESSION_KEY); ++tabVersion.current;closeTitle();setUser(null); setProfile(null); setLibrary([]); setFeed([]);}
    catch(e) {Alert.alert('Não foi possível sair',message(e));} finally {setBusy(false);}
  }
  async function season(number:number) {
    if(!selected) return;
    const version = detailVersion.current;
    setBusy(true);
    try {
      const data = await api<{episodes:Episode[]}>(`/api/catalog/tv/${selected.externalId}/seasons/${number}`);
      if(version === detailVersion.current) {setEpisodes(data.episodes);setSelectedSeason(number);await tracking.refresh();}
    } catch(e) {if(version === detailVersion.current) Alert.alert('Temporada indisponível',message(e));} finally {setBusy(false);}
  }
  async function watchEpisode(episode:Episode) {
    await trackedAction(()=>tracking.watch(episode.id),watched.has(episode.id)?'Marcação removida.':'Episódio registrado no seu histórico.');
  }
  function markSeason() {
    if(selectedSeason === null) return;
    const version = detailVersion.current;
    Alert.alert('Marcar temporada como assistida?','Apenas episódios já lançados com data confirmada serão registrados.',[
      {text:'Cancelar',style:'cancel'},
      {text:'Marcar temporada',onPress:()=>{if(version === detailVersion.current) void trackedAction(()=>tracking.markSeason(selectedSeason),'Temporada atualizada. Episódios futuros ou sem data foram ignorados.');}},
    ]);
  }
  const label = (text:string,style?:object) => <Text style={[styles.text,{color:colors.text},style]}>{text}</Text>;
  const muted = (text:string) => label(text,{color:colors.muted,lineHeight:22});
  const button = (text:string,onPress:()=>void,secondary = false,unavailable = false) => <Pressable accessibilityRole="button" accessibilityState={{disabled:busy || progress.busy || unavailable}} disabled={busy || progress.busy || unavailable} onPress={onPress} style={({pressed})=>[styles.button,{backgroundColor:secondary?colors.surface:colors.accent,borderColor:colors.line,opacity:busy || progress.busy || unavailable || pressed ? .6 : 1}]}><Text style={[styles.buttonText,{color:secondary?colors.text:colors.ink}]}>{text}</Text></Pressable>;
  const trackingUnavailable = Boolean(user) && !progress.ready;
  const input = (placeholder:string,value:string,onChangeText:(text:string)=>void,secure = false) => <TextInput accessibilityLabel={placeholder} placeholder={placeholder} placeholderTextColor={colors.muted} value={value} onChangeText={onChangeText} secureTextEntry={secure} autoCapitalize="none" keyboardType={placeholder === 'E-mail'?'email-address':'default'} style={[styles.input,{color:colors.text,borderColor:colors.line,backgroundColor:colors.surface}]} />;
  const empty = (title:string,description:string) => <View style={[styles.empty,{borderColor:colors.line,backgroundColor:colors.surface}]}>{label('✦',{color:colors.accent,fontSize:36})}{label(title,styles.emptyTitle)}{muted(description)}</View>;
  function Card({item}: {item:Title}) {
    const image = imageUrl(item.posterPath);
    return <Pressable accessibilityRole="button" accessibilityLabel={`Ver ${item.title}`} onPress={()=>void openTitle(item)} style={styles.card}>
      {image ? <Image source={{uri:image}} style={styles.poster} accessibilityLabel={`Pôster de ${item.title}`}/> : <View style={[styles.poster,styles.placeholder,{backgroundColor:colors.surface}]}>{muted('Arte indisponível')}</View>}
      <Text numberOfLines={2} style={[styles.cardTitle,{color:colors.text}]}>{item.title}</Text>
      {muted(`${item.releaseDate?.slice(0,4) ?? 'Sem data'} · ${item.mediaType === 'tv'?'Série':'Filme'}`)}
    </Pressable>;
  }
  function Shelf({title,items}: {title:string;items:Title[]}) {
    if(!items.length) return null;
    return <View style={styles.shelf}>{label(title,styles.sectionTitle)}<FlatList horizontal data={items} keyExtractor={item=>item.id} showsHorizontalScrollIndicator={false} renderItem={({item})=><Card item={item}/>} contentContainerStyle={styles.shelfContent}/></View>;
  }
  function renderAuth() {return <View style={styles.section}>
    {label('Sua próxima sessão começa aqui.',styles.heading)}
    {muted('Guarde seus filmes, acompanhe cada episódio e leve sua história para qualquer tela.')}
    {authMode === 'register' && <>{input('Nome de exibição',displayName,setDisplayName)}{input('Nome de usuário',username,setUsername)}</>}
    {input('E-mail',email,setEmail)}{input('Senha',password,setPassword,true)}
    {authMode === 'register' && muted('Use uma senha com pelo menos 10 caracteres.')}
    {button(busy?'Aguarde…':authMode === 'login'?'Entrar':'Criar conta',()=>void authenticate())}
    {button(authMode === 'login'?'Criar minha conta':'Já tenho uma conta',()=>{setAuthMode(authMode === 'login'?'register':'login');setError('');},true)}
  </View>;}
  function ActivityList({items}: {items:Activity[]}) {return <View style={styles.section}>{items.length ? items.map((item,index)=><View key={item.id ?? index} style={[styles.activity,{borderColor:colors.line}]}>{label(item.title ?? ({episode:'Episódio assistido',movie:'Filme assistido',rating:'Avaliação publicada',achievement:'Conquista desbloqueada'}[item.type ?? ''] ?? 'Atividade registrada'),{fontWeight:'700'})}{muted(dateLabel(item.createdAt ?? item.created_at))}</View>) : empty('A história ainda vai começar','As atividades registradas aparecerão aqui.')}</View>;}

  return <SafeAreaView style={[styles.safe,{backgroundColor:colors.bg}]}>
    <StatusBar style={theme === 'dark'?'light':'dark'}/>
    <View style={[styles.header,{borderColor:colors.line}]}><View>{label('barzinho.',styles.brand)}{label('CINEMA. CONVERSA. COMUNIDADE.',styles.eyebrow)}</View><Pressable accessibilityRole="button" accessibilityLabel="Alternar tema" onPress={()=>{const next = theme === 'dark'?'light':'dark';setTheme(next);void SecureStore.setItemAsync(THEME_KEY,next);}}><Text style={{fontSize:24,color:colors.accent}}>{theme === 'dark'?'☀':'☾'}</Text></Pressable></View>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
      {error ? <View style={styles.section}>{empty('Um intervalo na sessão',error)}{button('Tentar novamente',()=>void loadTab(),true)}</View> : null}
      {(loading || detailLoading) && <ActivityIndicator style={{margin:24}} color={colors.accent} accessibilityLabel="Carregando"/>}
      {tab === 'Início' && <>
        <View style={styles.section}>{label('SEU LUGAR NA PRIMEIRA FILA',{...styles.eyebrow,color:colors.accent})}{label('Toda boa história\nmerece companhia.',styles.heading)}{muted('Descubra o próximo favorito. Guarde cada sessão.')}{!user && button('Faça parte do barzinho',()=>setTab('Perfil'))}</View>
        {home ? <><Shelf title="Em alta hoje" items={home.trending}/><Shelf title="Em breve nos cinemas" items={home.upcoming}/><Shelf title="Para ficar na memória" items={home.topRated}/><Shelf title="Acabaram de chegar" items={home.recent}/></> : !loading && !error && <View style={styles.section}>{empty('As cortinas ainda estão fechadas','O catálogo está temporariamente indisponível. Tente novamente em instantes.')}</View>}
      </>}
      {tab === 'Explorar' && <View style={styles.section}>{label('Uma nova descoberta.',styles.heading)}{input('Busque filmes e séries',query,setQuery)}{query.length < 2 ? empty('O que vamos assistir?','Digite pelo menos dois caracteres para pesquisar o catálogo.') : results.length ? <View style={styles.grid}>{results.map(item=><Card key={item.id} item={item}/>)}</View> : !loading && !error && empty('Nenhum título encontrado','Experimente outro título ou o nome original da produção.')}</View>}
      {tab === 'Calendário' && <View style={styles.section}>{label('Reserve a próxima sessão.',styles.heading)}{muted('Próximas estreias de filmes no Brasil. Datas divulgadas pelo TMDB; podem mudar.')}{home?.upcoming.filter(item=>item.releaseDate && item.releaseDate >= new Date().toISOString().slice(0,10)).sort((a,b)=>(a.releaseDate??'').localeCompare(b.releaseDate??'')).map(item=><Pressable accessibilityRole="button" onPress={()=>void openTitle(item)} key={item.id} style={[styles.activity,{borderColor:colors.line}]}>{label(dateLabel(item.releaseDate),{color:colors.accent})}{label(item.title,{fontSize:19,fontWeight:'700'})}</Pressable>)}{!loading && !home?.upcoming.length && !error && empty('Sem estreias disponíveis','Novas datas aparecerão assim que forem informadas pela fonte do catálogo.')}</View>}
      {tab === 'Atividades' && <>{user ? <><View style={styles.section}>{label('Na mesa dos amigos.',styles.heading)}{muted('O que está movimentando as pessoas que você segue.')}</View><ActivityList items={feed}/></> : renderAuth()}</>}
      {tab === 'Perfil' && <>{user ? <View style={styles.section}>{label(`Olá, ${user.displayName}.`,styles.heading)}{muted(`@${user.username}`)}{profile && <><View style={styles.stats}>{Object.entries(profile.stats).filter(([key,value])=>typeof value === 'number' && ['moviesWatched','episodesWatched','hoursWatched','ratingsCount','films','episodes','hours','ratings'].includes(key)).map(([key,value])=><View key={key} style={[styles.stat,{backgroundColor:colors.surface}]}>{label(String(Math.round(value)),styles.statNumber)}{muted(({moviesWatched:'Filmes',episodesWatched:'Episódios',hoursWatched:'Horas',ratingsCount:'Avaliações',films:'Filmes',episodes:'Episódios',hours:'Horas',ratings:'Avaliações'} as Record<string,string>)[key])}</View>)}</View>{button(showLibrary?'Fechar minha biblioteca':'Minha biblioteca',()=>setShowLibrary(!showLibrary),true)}{showLibrary && (library.length ? <View style={styles.grid}>{library.map(item=><Card key={item.id} item={item}/>)}</View> : empty('Sua coleção começa com um título','Abra um filme ou série e adicione à sua lista.'))}{label('Minhas conquistas',styles.sectionTitle)}{profile.achievements?.map((badge,index)=><View key={badge.code ?? index} style={[styles.activity,{borderColor:colors.line}]}>{label(badge.name,{fontWeight:'700'})}{muted(badge.description)}{muted(badge.earnedAt ? `Conquistada em ${dateLabel(badge.earnedAt)}` : `${badge.progress ?? 0} de ${badge.goal ?? 1}`)}</View>)}{label('Meu diário',styles.sectionTitle)}<ActivityList items={profile.activity ?? []}/></>}{button('Sair da conta',()=>void logout(),true)}</View> : renderAuth()}</>}
      <View style={styles.section}>{muted('Este produto usa a API do TMDB, mas não é endossado nem certificado pelo TMDB.')}</View>
    </ScrollView>
    <View style={[styles.tabs,{borderColor:colors.line,backgroundColor:colors.surface}]}>{tabs.map((item,index)=><Pressable key={item} accessibilityRole="tab" accessibilityState={{selected:tab===item}} onPress={()=>{setTab(item);setError('');}} style={styles.tab}><Text style={{color:tab===item?colors.accent:colors.muted,fontSize:22}}>{['⌂','⌕','▦','◎','◉'][index]}</Text><Text style={{color:tab===item?colors.accent:colors.muted,fontSize:10,fontWeight:'700'}}>{item}</Text></Pressable>)}</View>
    <Modal visible={Boolean(selected)} animationType="slide" onRequestClose={closeTitle}><SafeAreaView style={[styles.safe,{backgroundColor:colors.bg}]}><ScrollView contentContainerStyle={styles.content}>
      {selected && <><View style={styles.section}>{button('← Voltar',closeTitle,true)}</View>{imageUrl(selected.backdropPath,'w780') && <Image source={{uri:imageUrl(selected.backdropPath,'w780')!}} style={styles.backdrop}/>}<View style={styles.section}>{label(selected.title,styles.heading)}{muted(`${selected.releaseDate?.slice(0,4) ?? 'Sem data'} · ${selected.genres.join(' / ')}${selected.runtime ? ` · ${selected.runtime} min` : ''}`)}{selected.voteAverage !== null && muted(`TMDB ${selected.voteAverage.toFixed(1)} / 10`)}{label(selected.overview || 'Sinopse ainda não disponível.',{lineHeight:25})}{statusMessage ? <Text accessibilityRole="alert" style={{color:colors.accent,paddingVertical:8}}>{statusMessage}</Text>:null}{progress.loading && <ActivityIndicator color={colors.accent} accessibilityLabel="Sincronizando seu progresso"/>}{progress.error ? <>{muted(progress.error)}{button('Atualizar meu progresso',()=>void tracking.refresh(),true)}</>:null}
      {progress.entry && muted(`Na sua biblioteca: ${{watchlist:'Quero assistir',watching:'Assistindo',completed:'Concluído',dropped:'Abandonei'}[progress.entry.status]}`)}
      {button(progress.entry?.status === 'watchlist'?'Na minha lista':'＋ Quero assistir',()=>void trackedAction(()=>tracking.setStatus('watchlist'),'Título salvo na sua lista.'),false,trackingUnavailable)}
      {button(progress.entry?.favorite?'♥ Remover dos favoritos':'♡ Favoritar',()=>void trackedAction(()=>tracking.toggleFavorite(),'Favoritos atualizados.'),true,trackingUnavailable)}
      {selected.mediaType === 'movie' ? button('Registrar sessão de hoje',confirmMovie,true,trackingUnavailable) : <>
        {button('Estou assistindo',()=>void trackedAction(()=>tracking.setStatus('watching'),'Série adicionada às que você acompanha.'),true,trackingUnavailable)}
        {button('Concluí a série',()=>void trackedAction(()=>tracking.setStatus('completed'),'Status da série atualizado.'),true,trackingUnavailable)}
        {button('Abandonei a série',()=>void trackedAction(()=>tracking.setStatus('dropped'),'Status da série atualizado.'),true,trackingUnavailable)}
      </>}
      {selected.trailer && button('Assistir ao trailer oficial',()=>void Linking.openURL(selected.trailer!.url),true)}{label('Sua avaliação',styles.sectionTitle)}{progress.ready && muted(progress.myRating === null?'Você ainda não avaliou este título.':`Nota salva: ${progress.myRating.toFixed(1)}`)}<View style={styles.rating}>{button('−',()=>setScore(Math.max(0,score-.5)),true)}{label(score.toFixed(1),styles.statNumber)}{button('+',()=>setScore(Math.min(10,score+.5)),true)}</View>{button('Salvar avaliação',()=>void trackedAction(()=>tracking.rate(score),'Sua avaliação foi salva.'),false,trackingUnavailable)}
      {selected.seasons?.length ? <>{label('Temporadas',styles.sectionTitle)}{selected.seasons.map(item=><View key={item.seasonNumber}>{button(`${item.name} · ${item.episodeCount} episódios`,()=>void season(item.seasonNumber),true)}</View>)}{selectedSeason !== null && <>{label(`Temporada ${selectedSeason}`,styles.sectionTitle)}{muted(`${episodes.filter(item=>watched.has(item.id)).length} de ${episodes.length} episódios assistidos`)}{button('Marcar temporada como assistida',markSeason,true,trackingUnavailable)}</>}{episodes.map(item=><View key={item.id} style={[styles.activity,{borderColor:colors.line}]}>{label(`${item.episodeNumber}. ${item.title}`,{fontWeight:'700',fontSize:17})}{muted(dateLabel(item.airDate))}{watched.has(item.id)?muted(item.overview || 'Sinopse ainda não disponível.'):muted('Sinopse oculta para evitar spoilers.')}{button(watched.has(item.id)?'Assistido · desfazer':'Marcar como assistido',()=>void watchEpisode(item),true,trackingUnavailable || (!watched.has(item.id) && Boolean(item.airDate && item.airDate > new Date().toISOString().slice(0,10))))}</View>)}</>:null}
      {selected.cast?.length ? <>{label('Quem dá vida à história',styles.sectionTitle)}{selected.cast.slice(0,12).map((person,index)=><View key={`${person.personId}:${index}`} style={[styles.activity,{borderColor:colors.line}]}>{label(person.name,{fontWeight:'700'})}{muted(person.character)}</View>)}</>:null}</View><Shelf title="Na mesma sintonia" items={selected.similar ?? []}/></>}
    </ScrollView></SafeAreaView></Modal>
  </SafeAreaView>;
}
const styles = StyleSheet.create({
  safe:{flex:1},content:{paddingBottom:28},header:{paddingHorizontal:22,paddingVertical:18,borderBottomWidth:1,flexDirection:'row',alignItems:'center',justifyContent:'space-between'},brand:{fontSize:29,fontWeight:'900',letterSpacing:-1.7},eyebrow:{fontSize:9,letterSpacing:2,lineHeight:20},text:{fontSize:14},section:{paddingHorizontal:22,paddingTop:24,gap:14},heading:{fontSize:34,fontWeight:'800',letterSpacing:-1.5,lineHeight:40},sectionTitle:{fontSize:21,fontWeight:'700',letterSpacing:-.5,marginTop:10},button:{borderWidth:1,borderRadius:12,paddingVertical:14,paddingHorizontal:18,minHeight:48,alignItems:'center',justifyContent:'center'},buttonText:{fontSize:14,fontWeight:'700'},input:{minHeight:52,borderWidth:1,borderRadius:12,paddingHorizontal:15,fontSize:15},empty:{borderWidth:1,borderRadius:18,padding:25,gap:12},emptyTitle:{fontSize:23,fontWeight:'700'},shelf:{marginTop:30,paddingLeft:22,gap:16},shelfContent:{gap:14,paddingRight:22},card:{width:146,gap:5,marginBottom:12},poster:{width:146,height:217,borderRadius:12},placeholder:{alignItems:'center',justifyContent:'center',padding:16},cardTitle:{fontWeight:'700',fontSize:14,lineHeight:19},grid:{flexDirection:'row',flexWrap:'wrap',gap:18,justifyContent:'space-between'},tabs:{flexDirection:'row',borderTopWidth:1,paddingTop:9,paddingBottom:8},tab:{flex:1,alignItems:'center',gap:5,minHeight:46},activity:{borderBottomWidth:1,paddingVertical:16,gap:8},stats:{flexDirection:'row',flexWrap:'wrap',gap:10},stat:{width:'47%',borderRadius:14,padding:18,gap:4},statNumber:{fontSize:28,fontWeight:'800'},backdrop:{width:'100%',aspectRatio:16/9},rating:{flexDirection:'row',gap:25,alignItems:'center',justifyContent:'center'},
});
