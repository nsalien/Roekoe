/** De Ziekenboeg: isolate, treat and heal sick or injured pigeons. */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useGame } from '../game/GameContext';
import { useAuth } from '../auth/AuthContext';
import { api } from '../api/client';
import { Money, Spinner, useToast } from '../components/ui';
import { PigeonAvatar } from '../components/PigeonAvatar';
import type { InfirmaryConfig, Pigeon, Severity } from '../types';

const SEV_RANK: Record<Severity, number> = { ernstig: 3, matig: 2, licht: 1 };

function SeverityBadge({ s }: { s: Severity }) {
  const cls = s === 'ernstig' ? 'sev-ernstig' : s === 'matig' ? 'sev-matig' : 'sev-licht';
  return <span className={`badge ${cls}`}>{s}</span>;
}

export function InfirmaryPage() {
  const { state, refresh } = useGame();
  const { user } = useAuth();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  // One-time introduction, remembered per user (per browser).
  const introKey = `roekoe.introSeen.infirmary.${user?.id ?? 'anon'}`;
  const [showIntro, setShowIntro] = useState(() => !localStorage.getItem(introKey));
  function dismissIntro() {
    try {
      localStorage.setItem(introKey, '1');
    } catch {
      /* private mode — just close */
    }
    setShowIntro(false);
  }

  if (!state) return <Spinner />;
  const { loft, pigeons, infirmary: cfg } = state;
  if (!loft) return <div className="card">Geen hok gevonden.</div>;

  const inBoeg = pigeons.filter((p) => p.inInfirmary);
  const ailingOutside = pigeons.filter((p) => p.ailment && !p.inInfirmary);

  // Mirror the server's severity-first coverage so we can show who's treated.
  const bySev = (a: Pigeon, b: Pigeon) => SEV_RANK[b.ailment!.severity] - SEV_RANK[a.ailment!.severity];
  const sickIn = inBoeg.filter((p) => p.ailment?.kind === 'ziekte').sort(bySev);
  const injIn = inBoeg.filter((p) => p.ailment?.kind === 'kwetsuur').sort(bySev);
  const covered = new Set<string>([
    ...sickIn.slice(0, loft.doctors * cfg.birdsPerDoctor).map((p) => p.id),
    ...injIn.slice(0, loft.physios * cfg.birdsPerPhysio).map((p) => p.id),
  ]);

  const medFoodCost = loft.medicatedFood ? loft.infirmaryCount * cfg.medicatedFoodPerBird : 0;
  const staffCost = loft.doctors * cfg.doctorSalary + loft.physios * cfg.physioSalary;
  const weeklyCost = medFoodCost + staffCost;

  async function act(fn: () => Promise<unknown>, ok?: string) {
    setBusy(true);
    try {
      await fn();
      await refresh();
      if (ok) toast.show(ok, 'ok');
    } catch (e) {
      toast.show(e instanceof Error ? e.message : 'Mislukt', 'err');
    } finally {
      setBusy(false);
    }
  }

  const setStaff = (doctors: number, physios: number) =>
    act(() => api('/loft/infirmary/staff', { method: 'POST', body: { doctors, physios } }));

  return (
    <div>
      {showIntro && <InfirmaryIntro cfg={cfg} onClose={dismissIntro} />}

      <div className="page-head">
        <div>
          <h1>🏥 De Ziekenboeg</h1>
          <p className="muted">
            Zieke of gekwetste duiven herstellen hier in afzondering — en besmetten zo de rest van het hok niet.
          </p>
        </div>
        <span className="chip week">{loft.infirmaryCount} / {loft.infirmaryCapacity} bezet</span>
      </div>

      {/* Care controls */}
      <div className="card">
        <h2>Verzorging</h2>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 14, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 240 }}>
            {/* Medicated food */}
            <div className="row" style={{ justifyContent: 'space-between', gap: 10 }}>
              <div>
                <strong>💊 Medicinaal voer</strong>
                <div className="faint">Verhoogt de herstelkans van élke duif in de boeg. <Money value={cfg.medicatedFoodPerBird} />/duif per week.</div>
              </div>
              <button
                className={`btn sm ${loft.medicatedFood ? 'accent' : 'ghost'}`}
                disabled={busy}
                style={{ flexShrink: 0 }}
                onClick={() => act(() => api('/loft/infirmary/medicated', { method: 'POST', body: { on: !loft.medicatedFood } }))}
              >
                {loft.medicatedFood ? 'Aan' : 'Uit'}
              </button>
            </div>

            <hr className="sep" />

            {/* Doctor */}
            <div className="row" style={{ justifyContent: 'space-between', gap: 10 }}>
              <div>
                <strong>🩺 Duivendokter</strong>
                <div className="faint">
                  Geneest ziektes. 1 dokter behandelt {cfg.birdsPerDoctor} zieke duiven. <Money value={cfg.doctorSalary} />/week.
                </div>
                <div className="faint">Dekt nu {loft.doctors * cfg.birdsPerDoctor} zieke duiven.</div>
              </div>
              <Stepper value={loft.doctors} disabled={busy} onChange={(v) => setStaff(v, loft.physios)} />
            </div>

            <hr className="sep" />

            {/* Physio */}
            <div className="row" style={{ justifyContent: 'space-between', gap: 10 }}>
              <div>
                <strong>🦴 Duivenkinesist</strong>
                <div className="faint">
                  Geneest kwetsuren zoals een verstuikte vleugel. 1 kinesist behandelt {cfg.birdsPerPhysio} duiven. <Money value={cfg.physioSalary} />/week.
                </div>
                <div className="faint">Dekt nu {loft.physios * cfg.birdsPerPhysio} gekwetste duiven.</div>
              </div>
              <Stepper value={loft.physios} disabled={busy} onChange={(v) => setStaff(loft.doctors, v)} />
            </div>
          </div>
        </div>

        <hr className="sep" />
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span className="muted">Wekelijkse kost ziekenboeg</span>
          <strong><Money value={weeklyCost} /></strong>
        </div>
        <p className="faint" style={{ margin: '6px 0 0', fontSize: '0.8rem' }}>
          De kosten worden elke week afgehouden bij “Volgende week”. Zonder behandeling herstelt een duif traag en riskeert ze te bezwijken — vooral bij ernstige aandoeningen.
        </p>
      </div>

      {/* Birds resting in the infirmary */}
      <div className="page-head" style={{ marginTop: 22 }}>
        <h2>In de ziekenboeg ({inBoeg.length})</h2>
      </div>
      {inBoeg.length === 0 ? (
        <div className="card muted">Geen duiven in de ziekenboeg. Gelukkig maar!</div>
      ) : (
        <div className="grid pigeons">
          {inBoeg.map((p) => (
            <AilingCard
              key={p.id}
              p={p}
              treated={covered.has(p.id)}
              medFood={loft.medicatedFood}
              busy={busy}
              action="out"
              onMove={() => act(() => api(`/pigeons/${p.id}/infirmary`, { method: 'POST', body: { in: false } }), `${p.name} terug naar het hok`)}
            />
          ))}
        </div>
      )}

      {/* Ailing birds still in the normal loft */}
      {ailingOutside.length > 0 && (
        <>
          <div className="page-head" style={{ marginTop: 22 }}>
            <h2>⚠️ Ziek/gewond in het hok ({ailingOutside.length})</h2>
          </div>
          <div className="card" style={{ marginBottom: 12, borderColor: 'var(--bad)' }}>
            <p className="muted" style={{ margin: 0 }}>
              Deze duiven zijn níét afgezonderd. Zieke duiven kunnen de rest van je hok besmetten — hoe lager de gezondheid van een duif, hoe groter het risico. Verplaats ze naar de ziekenboeg.
            </p>
          </div>
          <div className="grid pigeons">
            {ailingOutside.map((p) => (
              <AilingCard
                key={p.id}
                p={p}
                treated={false}
                medFood={false}
                busy={busy || loft.infirmaryCount >= loft.infirmaryCapacity}
                action="in"
                onMove={() => act(() => api(`/pigeons/${p.id}/infirmary`, { method: 'POST', body: { in: true } }), `${p.name} naar de ziekenboeg`)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function InfirmaryIntro({ cfg, onClose }: { cfg: InfirmaryConfig; onClose: () => void }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2 style={{ marginTop: 0 }}>🏥 Welkom in de Ziekenboeg</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Even kort uitleggen waar deze afdeling voor dient — je ziet dit maar één keer.
        </p>

        <ul className="intro-list">
          <li>
            <strong>Herstelplek.</strong> Hier laat je <em>zieke of gekwetste</em> duiven bijkomen,
            afgezonderd van de rest van je hok.
          </li>
          <li>
            <strong>Stopt besmetting.</strong> Een zieke duif die in je gewone hok blijft, kan
            hokgenoten aansteken — hoe lager hun gezondheid, hoe groter het risico. In de ziekenboeg
            besmet ze niemand.
          </li>
          <li>
            <strong>Sneller genezen.</strong> Duiven herstellen hier veel sneller dan in het hok,
            en nóg sneller met de juiste verzorging.
          </li>
          <li>
            <strong>Verzorging (zoals het voedersysteem):</strong> 💊 medicinaal voer verhoogt de
            herstelkans van iedereen, een 🩺 duivendokter geneest ziektes ({cfg.birdsPerDoctor} per dokter)
            en een 🦴 duivenkinesist geneest kwetsuren ({cfg.birdsPerPhysio} per kinesist). Personeel kost
            weeksalaris.
          </li>
          <li>
            <strong>Let op.</strong> Onbehandelde ernstige aandoeningen (of hoge ouderdom) kunnen
            dodelijk zijn. Duiven in de ziekenboeg kunnen niet vliegen, trainen of kweken.
          </li>
        </ul>

        <p className="faint" style={{ fontSize: '0.82rem' }}>
          Je verplaatst een duif hierheen via haar eigen pagina, of via de knoppen op deze pagina.
          De ziekenboeg heeft momenteel plaats voor {cfg.baseCapacity} duiven.
        </p>

        <button className="btn accent block" onClick={onClose}>Begrepen! 🕊️</button>
      </div>
    </div>
  );
}

function Stepper({ value, onChange, disabled }: { value: number; onChange: (v: number) => void; disabled?: boolean }) {
  return (
    <div className="row" style={{ gap: 6, flexShrink: 0, alignItems: 'center' }}>
      <button className="btn ghost sm" disabled={disabled || value <= 0} onClick={() => onChange(value - 1)}>−</button>
      <strong style={{ minWidth: 18, textAlign: 'center' }}>{value}</strong>
      <button className="btn ghost sm" disabled={disabled} onClick={() => onChange(value + 1)}>+</button>
    </div>
  );
}

function AilingCard({
  p,
  treated,
  medFood,
  busy,
  action,
  onMove,
}: {
  p: Pigeon;
  treated: boolean;
  medFood: boolean;
  busy?: boolean;
  action: 'in' | 'out';
  onMove: () => void;
}) {
  const a = p.ailment;
  return (
    <div className="card">
      <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
        <PigeonAvatar pigeon={p} size={64} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="row" style={{ justifyContent: 'space-between', gap: 6 }}>
            <Link to={`/duif/${p.id}`} style={{ color: 'inherit' }}><strong>{p.name}</strong></Link>
            {a && <SeverityBadge s={a.severity} />}
          </div>
          {a && (
            <>
              <div style={{ marginTop: 4 }}>
                <span className="badge" style={{ background: a.kind === 'ziekte' ? 'var(--bad-soft)' : 'var(--gold-soft)', color: a.kind === 'ziekte' ? 'var(--bad)' : 'var(--gold)' }}>
                  {a.kind === 'ziekte' ? '🦠 Ziekte' : '🩹 Kwetsuur'}: {a.name}
                </span>
              </div>
              <p className="faint" style={{ margin: '6px 0 0', fontSize: '0.83rem' }}>{a.description}</p>
            </>
          )}
          {action === 'out' && (
            <div className="faint" style={{ marginTop: 6, fontSize: '0.8rem' }}>
              {treated ? '✅ Onder behandeling' : '⏳ Wacht op verzorging'}{medFood ? ' · 💊 medicinaal voer' : ''}
            </div>
          )}
        </div>
      </div>
      <button className={`btn ${action === 'in' ? 'accent' : 'ghost'} block sm`} style={{ marginTop: 10 }} disabled={busy} onClick={onMove}>
        {action === 'in' ? '→ Naar ziekenboeg' : '← Terug naar hok'}
      </button>
    </div>
  );
}
