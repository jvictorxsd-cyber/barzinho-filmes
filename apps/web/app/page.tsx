import { Suspense } from 'react';
import { Screen } from '../components/screen';
export default function Page(){ return <Suspense fallback={<p>Carregando…</p>}><Screen/></Suspense>; }
