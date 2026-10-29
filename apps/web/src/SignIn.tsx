import { useState } from 'react';
import { auth, type AuthState } from './api.ts';

/** The first visit makes the account with the setup code; later ones sign in. */
export function SignIn({ state, onDone }: { state: AuthState; onDone: () => void }) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await (state.setup ? auth.setup(code, name, password) : auth.login(name, password));
      onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="signin" onSubmit={submit}>
      <h1>{state.setup ? 'Set up Telios' : 'Sign in'}</h1>
      {state.setup && <p className="sub">Enter the setup code from this server's .env file (TELIOS_SETUP_CODE), then choose the name and password you will sign in with.</p>}
      {state.setup && (
        <label className="field"><div className="label">Setup code</div><input className="text" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" required /></label>
      )}
      <label className="field"><div className="label">Name</div><input className="text" value={name} onChange={(e) => setName(e.target.value)} autoComplete="username" required /></label>
      <label className="field">
        <div className="label">Password</div>
        <input className="text" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={state.setup ? 'new-password' : 'current-password'} minLength={state.setup ? 10 : undefined} required />
      </label>
      {error && <p className="errors" role="alert">{error}</p>}
      <button className="primary" disabled={busy}>{state.setup ? 'Make the account' : 'Sign in'}</button>
    </form>
  );
}
