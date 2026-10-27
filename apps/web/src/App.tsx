import { useEffect, useState } from 'react';
import { api, type Health } from './api.ts';
import { Library } from './Library.tsx';
import { DesignPage } from './DesignPage.tsx';

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
  const [health, setHealth] = useState<Health | null>(null);
  useEffect(() => {
    const check = () => api.health().then(setHealth).catch(() => setHealth(null));
    check();
    // a key added (and Telios restarted) shows up without a reload
    addEventListener('focus', check);
    const t = setInterval(check, 60_000);
    return () => { removeEventListener('focus', check); clearInterval(t); };
  }, []);
  const designId = hash.match(/^#\/d\/([a-z0-9]+)/)?.[1];

  return (
    <div className="app">
      <header className="top">
        <a className="brand" href="#/">
          <svg viewBox="0 0 32 32" width="22" height="22" aria-hidden="true"><rect x="3" y="3" width="26" height="26" rx="2" fill="none" stroke="currentColor" strokeWidth="2.5" /><rect x="8.5" y="8.5" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.2" /><circle cx="16" cy="16" r="3.2" fill="var(--accent)" /></svg>
          Telios
        </a>
        <span className="tagline">Old designs, redrawn as new vector art</span>
        <span className="spacer" />
        {health && (
          <button className={`health ${health.model.ok ? 'ok' : health.model.provider === 'none' ? 'none' : 'off'}`} title={health.model.error ?? `${health.model.label} ${health.model.name}, ${health.effort} effort`} onClick={() => api.health(true).then(setHealth)}>
            {health.model.ok ? `${health.model.label} ready · ${health.model.name}` : health.model.provider === 'none' ? 'No model: Rebuild and Trace' : `${health.model.label} not connected`}
          </button>
        )}
      </header>
      <main>{designId ? <DesignPage id={designId} health={health} /> : <Library />}</main>
    </div>
  );
}
