/**
 * Inrichting: alles wat je aan je hok koopt, op één pagina, zodat Mijn hok
 * over de duiven blijft gaan. Gegroepeerd op waarvoor het dient: bouwen &
 * uitbreiden (plaatsen, aparte hokken, partnerhok, ziekenboegbedden, ren),
 * hygiëne & klimaat, vaccins, kweek en vluchten. De scout en het vakblad
 * (marktinformatie) staan op de Markt; verzekering en weduwschap op de pagina
 * van een duif.
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useGame } from '../game/GameContext';
import { Spinner, useToast } from '../components/ui';
import { BreedingGearCard, BuildCard, FlightGearCard, HygieneCard, VaccineCard } from '../components/Inrichting';

export function InrichtingPage() {
  const { state, loading, refresh } = useGame();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
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

  const loft = state.loft;
  const cat = state.inrichting ?? null;
  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Inrichting</h1>
          <p className="muted">
            Kort wat elk onderdeel doet · exacte cijfers en formules in de <Link to="/wiki#inrichting">wiki</Link> ·{' '}
            <Link to="/hok">naar je duiven →</Link>
          </p>
        </div>
      </div>
      <BuildCard loft={loft} cat={cat} upkeepBands={state.economy.upkeepBands ?? []} busy={busy} act={act} />
      {loft.equipment && <HygieneCard loft={loft} cat={cat} busy={busy} act={act} />}
      {loft.equipment && cat && (
        <>
          <VaccineCard loft={loft} pigeons={state.pigeons} cat={cat} busy={busy} act={act} />
          <BreedingGearCard loft={loft} cat={cat} busy={busy} act={act} />
          <FlightGearCard loft={loft} cat={cat} busy={busy} act={act} />
          <p className="faint" style={{ fontSize: '0.8rem', margin: 0 }}>
            De scout en het vakblad vind je op de <Link to="/markt">Markt</Link>, verzekering en weduwschap op de pagina van een duif.
          </p>
        </>
      )}
    </div>
  );
}
