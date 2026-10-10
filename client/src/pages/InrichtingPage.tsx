/**
 * Inrichting: alles wat je aan je hok koopt, op één pagina, zodat Mijn hok
 * over de duiven blijft gaan. Vier blokken, elk met in één regel hoe je ervoor
 * staat; je opent er één tegelijk (de eigenaar vond de lange lijst te veel):
 * plaatsen & hokken, hygiëne, vaccins & kuren, uitrusting. De scout en het
 * vakblad (marktinformatie) staan op de Markt; de verzekering op de pagina van
 * een duif.
 */

import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useGame } from '../game/GameContext';
import { Spinner, useToast } from '../components/ui';
import { GearSection, HygieneSection, RoomsSection, VaccineSection } from '../components/Inrichting';

/** Which block is open — a per-viewer convenience, so coming back opens the same one. */
const OPEN_KEY = 'roekoe.inrichting.open';
const SECTIONS = ['hokken', 'hygiene', 'vaccins', 'uitrusting'];

function readOpen(): string | null {
  try {
    return localStorage.getItem(OPEN_KEY);
  } catch {
    return null;
  }
}

export function InrichtingPage() {
  const { state, loading, refresh } = useGame();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  // A link like /inrichting#hokken opens that block; otherwise the one you had open.
  const { hash } = useLocation();
  const [open, setOpen] = useState<string | null>(() => (SECTIONS.includes(hash.slice(1)) ? hash.slice(1) : readOpen()));
  useEffect(() => {
    if (SECTIONS.includes(hash.slice(1))) setOpen(hash.slice(1));
  }, [hash]);
  if (loading || !state || !state.loft) return <Spinner />;

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

  const toggle = (id: string) => () => {
    const next = open === id ? null : id;
    setOpen(next);
    try {
      if (next) localStorage.setItem(OPEN_KEY, next);
      else localStorage.removeItem(OPEN_KEY);
    } catch {
      /* private mode: it simply won't be remembered */
    }
  };

  const loft = state.loft;
  const cat = state.inrichting ?? null;
  const shared = { busy, act };
  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Inrichting</h1>
          <p className="muted">
            Tik een blok open · exacte cijfers in de <Link to="/wiki#inrichting">wiki</Link> · <Link to="/hok">naar je duiven →</Link>
          </p>
        </div>
      </div>
      <RoomsSection {...shared} loft={loft} upkeepBands={state.economy.upkeepBands ?? []} open={open === 'hokken'} onToggle={toggle('hokken')} />
      {loft.equipment && <HygieneSection {...shared} loft={loft} open={open === 'hygiene'} onToggle={toggle('hygiene')} />}
      {loft.equipment && cat && (
        <>
          <VaccineSection {...shared} loft={loft} pigeons={state.pigeons} cat={cat} open={open === 'vaccins'} onToggle={toggle('vaccins')} />
          <GearSection {...shared} loft={loft} cat={cat} open={open === 'uitrusting'} onToggle={toggle('uitrusting')} />
          <p className="faint" style={{ fontSize: '0.8rem', marginTop: 14 }}>
            De scout en het vakblad vind je op de <Link to="/markt">Markt</Link>, de verzekering op de pagina van een duif.
          </p>
        </>
      )}
    </div>
  );
}
