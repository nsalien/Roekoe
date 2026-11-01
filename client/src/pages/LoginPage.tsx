/** Login / registration screen with a friendly hero. */

import { useState, type FormEvent } from 'react';
import { useAuth } from '../auth/AuthContext';

export function LoginPage() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loftName, setLoftName] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === 'login') await login(username, password);
      else await register(username, password, loftName, inviteCode);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Er ging iets mis');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="center-screen">
      <div style={{ width: '100%', maxWidth: 420 }}>
        <div style={{ textAlign: 'center', marginBottom: 18 }}>
          <div style={{ fontSize: '3.4rem', lineHeight: 1 }}>🕊️</div>
          <h1 style={{ fontSize: '2rem', margin: '6px 0 2px' }}>Roekoe</h1>
          <p className="muted">Bouw je duivenhok, train je kampioenen en win de vluchten.</p>
        </div>

        <div className="card">
          <div className="pill-tabs" style={{ marginBottom: 16, width: '100%' }}>
            <button className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')} style={{ flex: 1 }}>
              Inloggen
            </button>
            <button className={mode === 'register' ? 'active' : ''} onClick={() => setMode('register')} style={{ flex: 1 }}>
              Registreren
            </button>
          </div>

          {error && <div className="notice err">{error}</div>}

          <form onSubmit={submit}>
            <div className="field">
              <label>Gebruikersnaam</label>
              <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required />
            </div>
            <div className="field">
              <label>Wachtwoord</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                required
              />
            </div>
            {mode === 'register' && (
              <>
                <div className="field">
                  <label>Naam van je hok</label>
                  <input value={loftName} onChange={(e) => setLoftName(e.target.value)} placeholder="bv. De Snelle Wieken" />
                </div>
                <div className="field">
                  <label>Uitnodigingscode</label>
                  <input value={inviteCode} onChange={(e) => setInviteCode(e.target.value)} placeholder="van je vriend gekregen" />
                </div>
              </>
            )}
            <button className="btn block" type="submit" disabled={busy}>
              {busy ? 'Even geduld…' : mode === 'login' ? 'Inloggen' : 'Hok starten'}
            </button>
          </form>
        </div>
        <p className="faint" style={{ textAlign: 'center', marginTop: 12 }}>
          Een spel voor vrienden · bots vliegen mee als tegenstander
        </p>
      </div>
    </div>
  );
}
