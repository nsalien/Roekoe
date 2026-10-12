/**
 * Samen kweken (Kweek → tab "Samen kweken"): breed with another player's bird.
 * Three blocks, the one that asks something of you first: your negotiations,
 * then every bird that is put up (like the market), then putting up your own.
 * The rules and the numbers live in the wiki (#samen-kweken); this screen only
 * shows what decides the click.
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { Money, useToast } from './ui';
import { PigeonAvatar } from './PigeonAvatar';
import { PigeonCard } from './PigeonCard';
import type { KinshipDegree, Pigeon, StudCriteria, StudDealView, StudListingView, StudView, StudWants } from '../types';

/** POST an action; resolves to whether it worked (a failure is already shown as a toast). */
type Run = (path: string, body: unknown, ok: string) => Promise<boolean>;

const KIN_LABEL: Record<KinshipDegree, string> = {
  'directe-lijn': 'rechtstreekse familie',
  volle: 'volle broer en zus',
  half: 'halfbroer en halfzus',
  familie: 'familie van elkaar',
};

/** "★70+ · ⚡30+ · ❤30+" — what a partner must have. */
function criteriaLine(c: StudCriteria): string {
  return [`★${c.minScore}+`, c.minEnergy > 0 && `⚡${c.minEnergy}+`, c.minLibido > 0 && `❤${c.minLibido}+`]
    .filter(Boolean)
    .join(' · ');
}

/** Who keeps the young and who pays whom, from my side. */
function TermsLine({ youngToMe, fee, other }: { youngToMe: boolean; fee: number; other: string }) {
  return (
    <span>
      Jongen naar <strong>{youngToMe ? 'jou' : other}</strong>
      {fee > 0 ? (
        youngToMe ? <> · jij betaalt <Money value={fee} /></> : <> · jij krijgt <Money value={fee} /></>
      ) : (
        <> · zonder vergoeding</>
      )}
    </span>
  );
}

/**
 * "🐣 Het jong scoort naar schatting ★62" and, under it, what such a youngster is
 * worth on the market at birth — what both players see before they agree.
 */
function YoungScore({ score, value, kin }: { score: number; value: number; kin: KinshipDegree | null }) {
  return (
    <>
      <p style={{ margin: '0 0 2px' }}>
        🐣 Het jong scoort naar schatting <strong>★{Math.round(score)}</strong>
      </p>
      <p className="muted" style={{ margin: '0 0 6px', fontSize: '0.9rem' }}>
        Geschatte marktwaarde bij de geboorte: <Money value={value} />
      </p>
      {kin && (
        <p className="muted" style={{ margin: '0 0 6px', fontSize: '0.85rem' }}>
          ⚠️ Deze twee zijn {KIN_LABEL[kin]} — het jong krijgt lagere plafonds en wellicht een afwijking.
        </p>
      )}
    </>
  );
}

/**
 * The amount: the only thing the players negotiate. Who keeps the young was
 * decided by the owner of the listed bird when they put her up.
 */
function FeeForm({
  other,
  youngToMe,
  initial,
  submitLabel,
  busy,
  onSubmit,
  onCancel,
}: {
  other: string;
  youngToMe: boolean;
  initial: number;
  submitLabel: string;
  busy: boolean;
  onSubmit: (fee: number) => void;
  onCancel?: () => void;
}) {
  const [fee, setFee] = useState(String(initial));
  const feeNum = Math.max(0, Math.round(Number(fee) || 0));
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="field" style={{ margin: 0 }}>
        <label>{youngToMe ? `Ik betaal ${other}` : `${other} betaalt mij`} (€, bij de geboorte)</label>
        <input type="number" min={0} step={50} inputMode="numeric" value={fee} onChange={(e) => setFee(e.target.value)} />
      </div>
      <div className="row" style={{ gap: 8 }}>
        <button className="btn" disabled={busy} onClick={() => onSubmit(feeNum)}>{submitLabel}</button>
        {onCancel && <button className="btn ghost" disabled={busy} onClick={onCancel}>Annuleren</button>}
      </div>
    </div>
  );
}

/** What the owner of a listed bird wants, from the point of view of someone looking at it. */
function wantsLine(wants: StudWants, mine: boolean): string {
  if (mine) return wants === 'young' ? 'Jij houdt de jongen en betaalt de vergoeding' : 'Jij krijgt de vergoeding, de jongen gaan naar je partner';
  return wants === 'young' ? 'Wil zelf de jongen — jij krijgt de vergoeding' : 'Wil de vergoeding — de jongen zijn voor jou';
}

function DealCard({
  deal,
  cost,
  busy,
  run,
}: {
  deal: StudDealView;
  cost: number;
  busy: boolean;
  run: Run;
}) {
  const [countering, setCountering] = useState(false);
  const mine = deal.role === 'stud' ? deal.stud : deal.mate;
  const theirs = deal.role === 'stud' ? deal.mate : deal.stud;
  return (
    <div className="card" style={{ boxShadow: 'none', background: 'var(--surface-2)' }}>
      <div className="row" style={{ gap: 8, flexWrap: 'nowrap', alignItems: 'center' }}>
        <PigeonAvatar pigeon={mine} size={44} />
        <span>💕</span>
        <PigeonAvatar pigeon={theirs} size={44} />
        <div style={{ minWidth: 0 }}>
          <div>
            <Link to={`/duif/${mine.id}`}>{mine.name}</Link> × <Link to={`/duif/${theirs.id}`}>{theirs.name}</Link>
          </div>
          <div className="faint" style={{ fontSize: '0.85rem' }}>
            ★{mine.talent} × ★{theirs.talent} · met {deal.otherName}
          </div>
        </div>
      </div>
      <p style={{ margin: '8px 0 6px' }}>
        <TermsLine youngToMe={deal.youngToMe} fee={deal.fee} other={deal.otherName} />
      </p>
      <YoungScore score={deal.youngScore} value={deal.youngValue} kin={deal.kin} />
      {deal.myTurn ? (
        countering ? (
          <FeeForm
            other={deal.otherName}
            youngToMe={deal.youngToMe}
            initial={deal.fee}
            submitLabel="Tegenvoorstel sturen"
            busy={busy}
            onSubmit={(fee) =>
              run(`/breeding/stud/${deal.id}/counter`, { fee }, 'Tegenvoorstel verstuurd.').then((ok) => ok && setCountering(false))
            }
            onCancel={() => setCountering(false)}
          />
        ) : (
          <>
            {deal.blocked && <p className="muted" style={{ margin: '0 0 6px', fontSize: '0.85rem' }}>Nu nog niet: {deal.blocked}.</p>}
            <div className="row" style={{ gap: 8 }}>
              <button
                className="btn"
                disabled={busy || !!deal.blocked}
                onClick={() => run(`/breeding/stud/${deal.id}/accept`, {}, 'Akkoord! Het nest is gestart — wanneer (en óf) er jongen komen, is een verrassing. 🥚')}
              >
                Akkoord · <Money value={cost} />
              </button>
              <button className="btn secondary" disabled={busy} onClick={() => setCountering(true)}>Tegenvoorstel</button>
              <button className="btn ghost" disabled={busy} onClick={() => run(`/breeding/stud/${deal.id}/close`, {}, 'Voorstel afgesloten.')}>
                {deal.role === 'stud' ? 'Weigeren' : 'Intrekken'}
              </button>
            </div>
          </>
        )
      ) : (
        <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
          <span className="faint">Wacht op het antwoord van {deal.otherName}…</span>
          <button className="btn ghost sm" disabled={busy} onClick={() => run(`/breeding/stud/${deal.id}/close`, {}, 'Voorstel ingetrokken.')}>
            Intrekken
          </button>
        </div>
      )}
    </div>
  );
}

function ListingCard({
  listing,
  myPigeons,
  busy,
  run,
  onEdit,
}: {
  listing: StudListingView;
  myPigeons: Pigeon[];
  busy: boolean;
  run: Run;
  onEdit: (pigeonId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const p = listing.pigeon;
  // Free birds first: one on a nest or still resting can be offered, but the
  // agreement only goes through once she is free (the deal says so on your turn).
  // Sick or entered birds are not in the list at all (the server leaves them out).
  const tied = (m: Pigeon) =>
    m.breeding ? ' · 🥚 op een nest'
      : m.breedAvailableAt && Date.parse(m.breedAvailableAt) > Date.now() ? ' · 🪺 rust nog' : '';
  const estimate = new Map(listing.candidates.map((c) => [c.id, c]));
  const candidates = myPigeons
    .filter((m) => estimate.has(m.id))
    .sort((a, b) => Number(!!tied(a)) - Number(!!tied(b)) || estimate.get(b.id)!.youngScore - estimate.get(a.id)!.youngScore);
  const [mateId, setMateId] = useState(candidates[0]?.id ?? '');
  const chosen = estimate.get(mateId);
  // The owner decided up front: if they want the fee, the young are mine.
  const youngToMe = listing.wants === 'fee';
  return (
    <PigeonCard pigeon={p} showOwner showBreed showcase avatarSize={104}>
      <div className="badge" style={{ background: 'var(--brand-soft)', color: 'var(--brand-ink)', marginBottom: 6 }}>
        🤝 {listing.mine ? 'Jouw duif · ' : ''}zoekt {criteriaLine(listing.criteria)}
      </div>
      <div style={{ marginBottom: 6, fontSize: '0.9rem' }}>{wantsLine(listing.wants, listing.mine)}</div>
      {listing.busy && <div className="faint" style={{ marginBottom: 6, fontSize: '0.85rem' }}>Nu niet vrij: {listing.busy}.</div>}
      {listing.mine ? (
        <div className="row" style={{ gap: 8 }}>
          <button className="btn secondary" disabled={busy} onClick={() => onEdit(p.id)}>Aanpassen</button>
          <button
            className="btn ghost"
            disabled={busy}
            onClick={() => run('/breeding/stud/unlist', { pigeonId: p.id }, `${p.name} wordt niet meer aangeboden.`)}
          >
            Niet meer aanbieden
          </button>
        </div>
      ) : open ? (
        <div className="stack" style={{ gap: 8 }}>
          <div className="field" style={{ margin: 0 }}>
            <label>Jouw {p.sex === 'doffer' ? 'duivin' : 'doffer'}</label>
            <select value={mateId} onChange={(e) => setMateId(e.target.value)}>
              {candidates.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} (★{m.talent} · ❤{Math.round(m.libido ?? 0)} · ⚡{Math.round(m.form ?? 0)}) → jong ★{Math.round(estimate.get(m.id)!.youngScore)}{tied(m)}
                </option>
              ))}
            </select>
          </div>
          {chosen && <YoungScore score={chosen.youngScore} value={chosen.youngValue} kin={chosen.kin} />}
          {listing.askFee != null && (
            <p className="faint" style={{ margin: 0, fontSize: '0.85rem' }}>
              {listing.ownerName} laat de jongen aan jou voor <Money value={listing.askFee} />.
            </p>
          )}
          <FeeForm
            other={listing.ownerName}
            youngToMe={youngToMe}
            initial={listing.askFee ?? 0}
            submitLabel="Voorstel sturen"
            busy={busy || !mateId}
            onSubmit={(fee) =>
              run('/breeding/stud/propose', { studId: p.id, mateId, fee }, 'Voorstel verstuurd.').then((ok) => ok && setOpen(false))
            }
            onCancel={() => setOpen(false)}
          />
        </div>
      ) : candidates.length > 0 ? (
        <button className="btn block" disabled={busy} onClick={() => setOpen(true)}>Stel een duif voor</button>
      ) : (
        <p className="faint" style={{ margin: 0, fontSize: '0.85rem' }}>
          {listing.unfit > 0
            ? `Je ${p.sex === 'doffer' ? 'duivinnen' : 'doffers'} die in aanmerking komen, zijn ziek of ingeschreven voor een vlucht.`
            : listing.shortfall > 0
              ? `Geen van je ${p.sex === 'doffer' ? 'duivinnen' : 'doffers'} haalt wat ${listing.ownerName} vraagt.`
              : `Je hebt geen ${p.sex === 'doffer' ? 'duivin' : 'doffer'} die oud genoeg is.`}
        </p>
      )}
    </PigeonCard>
  );
}

/** Put one of your own birds up, or change what you ask. */
function OfferOwn({
  myPigeons,
  busy,
  run,
  selected,
  setSelected,
}: {
  myPigeons: Pigeon[];
  busy: boolean;
  run: Run;
  selected: string;
  setSelected: (id: string) => void;
}) {
  const MIN_BREED_WEEKS = 8; // BREEDING.minAgeWeeks
  const adults = myPigeons.filter((p) => p.ageWeeks >= MIN_BREED_WEEKS);
  const bird = adults.find((p) => p.id === selected);
  // A new offer starts without a choice between the young and the fee: the owner
  // has to make it, it decides what the whole negotiation is about.
  const defaults = (p?: Pigeon): StudCriteria =>
    p?.stud ?? { minScore: p ? Math.max(0, Math.floor((p.talent - 10) / 5) * 5) : 50, minEnergy: 30, minLibido: 30 };
  const [crit, setCrit] = useState<StudCriteria>(defaults(bird));
  const num = (key: 'minScore' | 'minEnergy' | 'minLibido', label: string) => (
    <div className="field" style={{ margin: 0, flex: '1 1 90px', minWidth: 0 }}>
      <label>{label}</label>
      <input
        type="number" min={0} max={100} inputMode="numeric" value={crit[key]}
        onChange={(e) => setCrit({ ...crit, [key]: Math.max(0, Math.min(100, Math.round(Number(e.target.value) || 0))) })}
      />
    </div>
  );
  return (
    <div className="card">
      <h2>Zelf een duif aanbieden</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        Gratis. Een aangeboden duif moet gezond zijn en blijft thuis: ze kan niet ingeschreven worden zolang ze
        aangeboden is. Jij kiest of je de jongen wil of de vergoeding, en wat een partner minstens moet hebben.
      </p>
      <div className="field">
        <label>Duif</label>
        <select value={selected} onChange={(e) => setSelected(e.target.value)}>
          <option value="">— kies een duif —</option>
          {adults.map((p) => {
            // A sick or entered bird cannot be put up (a listed one can still be edited).
            const why = p.stud ? '' : p.ailment || p.inInfirmary ? ' — ziek' : p.racing ? ' — ingeschreven' : '';
            return (
              <option key={p.id} value={p.id} disabled={!!why}>
                {p.stud ? '🤝 ' : ''}{p.name} ({p.sex} · ★{p.talent}){why}
              </option>
            );
          })}
        </select>
      </div>
      {bird && (
        <>
          <div className="field">
            <label>Wat wil jij?</label>
            <div className="chip-row" role="radiogroup" aria-label="De jongen of de vergoeding?">
              <button type="button" className={`chip ${crit.wants === 'young' ? 'active' : ''}`} onClick={() => setCrit({ ...crit, wants: 'young' })}>
                🐣 De jongen
              </button>
              <button type="button" className={`chip ${crit.wants === 'fee' ? 'active' : ''}`} onClick={() => setCrit({ ...crit, wants: 'fee' })}>
                💶 De vergoeding
              </button>
            </div>
          </div>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
            {num('minScore', 'Partner min. ★')}
            {num('minEnergy', 'Min. ⚡ energie')}
            {num('minLibido', 'Min. ❤ libido')}
          </div>
          <button
            className="btn block"
            disabled={busy || !crit.wants}
            onClick={() => run('/breeding/stud/list', { pigeonId: bird.id, ...crit }, `${bird.name} wordt aangeboden. 🤝`)}
          >
            {bird.stud ? 'Bijwerken' : 'Aanbieden'}
          </button>
        </>
      )}
    </div>
  );
}

export function SamenKweken({
  view,
  myPigeons,
  onChanged,
}: {
  view: StudView;
  myPigeons: Pigeon[];
  onChanged: () => Promise<void>;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState('');

  // The forms only close when the action worked; an error stays on screen as a toast.
  const run: Run = async (path, body, ok) => {
    setBusy(true);
    try {
      await api(path, { method: 'POST', body });
      toast.show(ok, 'ok');
      await onChanged();
      return true;
    } catch (e) {
      toast.show(e instanceof Error ? e.message : 'Mislukt', 'err');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const others = view.listings.filter((l) => !l.mine);
  const own = view.listings.filter((l) => l.mine);

  return (
    <div className="stack" style={{ gap: 16 }}>
      <p className="muted" style={{ margin: 0 }}>
        Kweek met de duif van een andere speler. Wie een duif aanbiedt, kiest of hij de jongen wil of de vergoeding; samen
        spreken jullie het bedrag af. Bij een akkoord betaalt elk <Money value={view.cost} />. <Link to="/wiki#samen-kweken">Hoe het werkt →</Link>
      </p>

      {view.deals.length > 0 && (
        <div className="card">
          <h2>Onderhandelingen</h2>
          <div className="stack">
            {view.deals.map((d) => (
              <DealCard key={d.id} deal={d} cost={view.cost} busy={busy} run={run} />
            ))}
          </div>
        </div>
      )}

      <div id="samen-zelf">
        <OfferOwn key={selected} myPigeons={myPigeons} busy={busy} run={run} selected={selected} setSelected={setSelected} />
      </div>

      <div>
        <h2 style={{ margin: '0 0 8px' }}>Aangeboden duiven</h2>
        {others.length === 0 && own.length === 0 && (
          <div className="card muted">Nog niemand biedt een duif aan. Doe het zelf hierboven!</div>
        )}
        <div className="grid pigeons">
          {[...others, ...own].map((l) => (
            <ListingCard
              key={l.pigeon.id}
              listing={l}
              myPigeons={myPigeons}
              busy={busy}
              run={run}
              onEdit={(id) => {
                setSelected(id);
                document.getElementById('samen-zelf')?.scrollIntoView({ behavior: 'smooth' });
              }}
            />
          ))}
        </div>
      </div>

    </div>
  );
}
