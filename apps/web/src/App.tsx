import { useCallback, useEffect, useState } from 'react';
import { api, auth, type AuthState, type Health } from './api.ts';
import { Library } from './Library.tsx';
import { DesignPage } from './DesignPage.tsx';
import { Studio } from './restyle/Studio.tsx';
import { SignIn } from './SignIn.tsx';

function useHash() {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const on = () => setHash(location.hash);
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);
  return hash;
}

export function App() {
  const hash = useHash();
  const [session, setSession] = useState<AuthState | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const checkSession = useCallback(() => auth.state().then(setSession).catch(() => setSession({ required: false, setup: false, signedIn: true, name: null })), []);
  useEffect(() => {
    checkSession();
    const out = () => checkSession();
    addEventListener('telios:signed-out', out);
    return () => removeEventListener('telios:signed-out', out);
  }, [checkSession]);
  const signedIn = !!session?.signedIn;
  useEffect(() => {
    if (!signedIn) return;
    const check = () => api.health().then(setHealth).catch(() => setHealth(null));
    check();
    // a key added (and Telios restarted) shows up without a reload
    addEventListener('focus', check);
    const t = setInterval(check, 60_000);
    return () => { removeEventListener('focus', check); clearInterval(t); };
  }, [signedIn]);

  if (!session) return null;
  if (!session.signedIn) return <div className="app"><SignIn state={session} onDone={checkSession} /></div>;

  const designId = hash.match(/^#\/d\/([a-z0-9]+)/)?.[1];
  const page = designId ? 'design' : hash.startsWith('#/designs') ? 'designs' : 'restyle';
  const c = health?.comfy;

  return (
    <div className="app">
      <header className="top">
        <a className="brand" href="#/">
          <svg viewBox="0 0 32 32" width="22" height="22" aria-hidden="true"><rect x="3" y="3" width="26" height="26" rx="2" fill="none" stroke="currentColor" strokeWidth="2.5" /><rect x="8.5" y="8.5" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.2" /><circle cx="16" cy="16" r="3.2" fill="var(--accent)" /></svg>
          Telios
        </a>
        <nav className="nav">
          <a href="#/" className={page === 'restyle' ? 'on' : ''}>Restyle</a>
          <a href="#/designs" className={page !== 'restyle' ? 'on' : ''}>Vector redraw</a>
        </nav>
        <span className="spacer" />
        {c && (
          <button className={`health ${c.ready ? 'ok' : 'off'}`} title={c.ready ? `${c.model}${c.via === 'api' ? ', through the Phansora API' : ', on this machine'}` : c.detail} onClick={() => api.health(true).then(setHealth)}>
            <i className="dot-live" aria-hidden="true" />{c.ready ? 'ComfyUI ready' : 'ComfyUI not ready'}
          </button>
        )}
        {health && (
          <button className={`health ${health.model.ok ? 'ok' : health.model.provider === 'none' ? 'none' : 'off'}`} title={health.model.error ?? `${health.model.label} ${health.model.name}: reads what each picture shows`} onClick={() => api.health(true).then(setHealth)}>
            {health.model.ok ? health.model.label : health.model.provider === 'none' ? 'No model' : `${health.model.label} off`} · FLUX
          </button>
        )}
        {session.required && <button className="quiet small" onClick={() => auth.logout().then(checkSession)}>Sign out</button>}
      </header>
      <main className={page === 'restyle' ? 'wide' : ''}>
        {page === 'design' ? <DesignPage id={designId!} health={health} /> : page === 'designs' ? <Library /> : <Studio health={health} />}
      </main>
    </div>
  );
}
