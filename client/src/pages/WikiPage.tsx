/**
 * Wiki — a strategy-oriented explainer of the game's key mechanics and odds.
 *
 * Deliberately NOT 100% transparent: it gives the numbers that shape a player's
 * strategy (energy costs, recovery, breeding/illness/injury/death odds, breed
 * rarity) in rounded, ballpark form, but keeps the exact hidden formulas and the
 * ever-present luck factor a mystery. Fully static/client-side — no backend, no
 * cost. Keep the figures in rough sync with core/config/gameConfig.ts by hand.
 */

const SECTIONS = [
  { id: 'genen', icon: '🧬', label: 'Genen & training' },
  { id: 'energie', icon: '⚡', label: 'Energie & herstel' },
  { id: 'vlucht', icon: '🏁', label: 'Energie per vlucht' },
  { id: 'lage-energie', icon: '🪫', label: 'Lage energie' },
  { id: 'broeden', icon: '🥚', label: 'Broeden' },
  { id: 'ziekte', icon: '🤒', label: 'Ziekte' },
  { id: 'sterfte', icon: '🕯️', label: 'Sterfte' },
  { id: 'rassen', icon: '🎨', label: 'Rassen' },
  { id: 'afscheid', icon: '👋', label: 'Afscheid nemen' },
];

const cell: React.CSSProperties = {
  padding: '7px 10px',
  borderBottom: '1px solid var(--border)',
  textAlign: 'left',
};
const headCell: React.CSSProperties = { ...cell, fontWeight: 700, color: 'var(--text-soft)' };

function MiniTable({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  return (
    <div className="table-wrap" style={{ marginTop: 10 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.92rem' }}>
        <thead>
          <tr>{head.map((h, i) => <th key={i} style={headCell}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri}>{r.map((c, ci) => <td key={ci} style={ci === 0 ? { ...cell, fontWeight: 600 } : cell}>{c}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Section({ id, icon, title, children }: { id: string; icon: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="card" style={{ scrollMarginTop: 90 }}>
      <div className="section-title"><h2>{icon} {title}</h2></div>
      {children}
    </section>
  );
}

export function WikiPage() {
  return (
    <div className="stack" style={{ gap: 14 }}>
      <div className="card">
        <div className="section-title"><h2>📖 Wiki — hoe het spel werkt</h2></div>
        <p className="muted" style={{ marginTop: 0 }}>
          De belangrijkste mechanismen die je strategie bepalen, met richtwaarden voor de
          kansen in het spel. <strong>Niet alles wordt verklapt:</strong> de exacte formules
          blijven geheim, en elke vlucht heeft een toevalsfactor (± 10%) — zelfs de beste
          duif verliest soms, en een underdog wint af en toe. Beschouw de cijfers hieronder
          als <em>richtwaarden, geen garanties</em>.
        </p>
        <div className="row" style={{ marginTop: 6 }}>
          {SECTIONS.map((s) => (
            <a key={s.id} href={`#${s.id}`} className="chip" style={{ textDecoration: 'none' }}>
              {s.icon} {s.label}
            </a>
          ))}
        </div>
      </div>

      <Section id="genen" icon="🧬" title="Genen, plafonds & training">
        <p className="muted" style={{ marginTop: 0 }}>
          Elke duif heeft <strong>aangeboren maxima</strong> (genen) voor snelheid, conditie en oriëntatie.
          <strong> Geen enkele duif haalt ooit 100</strong> in een racevaardigheid — de absolute bovengrens is 95, en
          de meeste duiven cappen lager. In je hok toont een <span style={{ color: 'var(--bad)', fontWeight: 700 }}>rood
          streepje</span> op elke statbalk waar die duif capt (klik erop voor de waarde).
        </p>
        <p><strong>Groeien gebeurt in drie trappen</strong>, elk met haar eigen weg omhoog:</p>
        <MiniTable
          head={['Bereik', 'Hoe je er groeit']}
          rows={[
            ['0 → 80', 'Trainen, vluchten of coach'],
            ['80 → 90', 'Vluchten of coach'],
            ['90 → gen-cap', 'Enkel een coach'],
          ]}
        />
        <ul style={{ marginTop: 12 }}>
          <li><strong>Trainen wordt duurder</strong> naarmate de waarde stijgt (exponentieel): 50→51 kost een prikje, 79→80 een flinke som. Elke vaardigheid kan 1× per week getraind worden — en maar tot 80.</li>
          <li><strong>Groei vertraagt</strong> naarmate een duif haar plafond nadert: 50→51 gaat vlot, 88→89 is een grind.</li>
          <li><strong>Een coach werkt op élk niveau</strong> en duwt elke vaardigheid dagelijks richting haar gen-cap; de winst wordt kleiner naar de cap toe en stopt daar. Enkel de coach gaat <strong>boven 90</strong>.</li>
          <li><strong>Genen bepalen mee de waarde:</strong> hogere plafonds = duurdere duif, ook al zijn de huidige stats nog laag. En ze <strong>erven door</strong> bij kweek — koppel je toppers om een sterke lijn te bouwen.</li>
          <li><strong>Verouderen:</strong> na haar piek (rond ~4 duivenjaar) zwakt een duif geleidelijk af in snelheid/conditie/oriëntatie — bij de ene sneller dan de andere.</li>
        </ul>
        <p><strong>Strategie:</strong> een jonge duif met hoge genen maar lage stats is goud waard — bouw ze op. Bewaar je coach-budget voor duiven die genetisch écht boven 90 kunnen, en fok met je best gegende koppels.</p>
      </Section>

      <Section id="energie" icon="⚡" title="Energie & herstel">
        <p className="muted" style={{ marginTop: 0 }}>
          Energie (de &laquo;fut&raquo; van een duif) daalt door vluchten en stijgt door voer en rust.
          Lage energie = slechtere prestaties, meer kans op ziekte en blessure, en minder kans op broeden.
        </p>
        <ul>
          <li><strong>Herstel gebeurt elke dag om 00:00</strong> (de dagovergang), voor alle duiven tegelijk — het maakt dus niet uit hoe laat je inlogt.</li>
          <li><strong>Je voerkeuze bepaalt hoeveel</strong> energie er per dag bijkomt (richtwaarden, gemiddelde duif):</li>
        </ul>
        <MiniTable
          head={['Voer', 'Energie/dag (ruw)', 'Extra']}
          rows={[
            ['Normaal', '≈ +3', '—'],
            ['Premium', '≈ +4', '+ gezondheid, + conditie'],
            ['Libido-mix', '≈ +2,5', '+ libido (voor de kweek)'],
            ['Herstelvoer', '≈ +6', 'ideaal na een zware vlucht'],
          ]}
        />
        <ul style={{ marginTop: 12 }}>
          <li><strong>Ervaring versnelt het herstel:</strong> een geroutineerde duif komt merkbaar sneller op krachten dan een groentje.</li>
          <li><strong>Rustbonus:</strong> blijft een duif thuis (geen vlucht) én krijgt ze elke dag eten, dan bouwt ze rust op — elke 3e zulke dag <strong>+4 energie</strong> bovenop het voer. De teller reset zodra ze een vlucht doet.</li>
          <li><strong>Apart hok:</strong> een duif in een apart hok herstelt sneller energie.</li>
        </ul>
        <p><strong>Strategie:</strong> laat een topduif af en toe bewust een dag thuis voor de rustbonus, en zet <em>Herstelvoer</em> op wie net een zware fondvlucht deed.</p>
      </Section>

      <Section id="vlucht" icon="🏁" title="Energie per vlucht">
        <p className="muted" style={{ marginTop: 0 }}>
          Hoe verder de vlucht, hoe meer energie ze kost. <strong>Ervaring verlaagt het verbruik</strong> —
          een geroutineerde duif doet zuiniger, een groentje verbruikt meer.
        </p>
        <MiniTable
          head={['Afstand', 'Verbruik (gemiddelde duif)', 'Onervaren']}
          rows={[
            ['± 300 km', '≈ 25 energie', '≈ 30'],
            ['± 500 km', '≈ 32 energie', '≈ 40'],
            ['± 1000 km (grote fond)', '≈ 48 energie', '≈ 59'],
          ]}
        />
        <ul style={{ marginTop: 12 }}>
          <li>Het verbruik wordt <strong>geleidelijk tijdens de vlucht</strong> afgetrokken; geeft een duif onderweg op, dan spaart ze de rest van haar energie.</li>
          <li>Een grote-fondvlucht kan een uitgeruste tank zowat helemaal leegtrekken — reken op enkele dagen herstel nadien.</li>
        </ul>
        <p><strong>Strategie:</strong> zet je meest <em>ervaren én best uitgeruste</em> duiven op de verste vluchten. Een frisse groentje op 1000 km is vragen om problemen.</p>
      </Section>

      <Section id="lage-energie" icon="🪫" title="Vliegen op lage energie: DNF, blessure & dood">
        <p className="muted" style={{ marginTop: 0 }}>
          Inschrijven kan vanaf <strong>1 energie</strong>, maar op een lege tank vliegen is riskant.
        </p>
        <ul>
          <li><strong>Niet thuis raken (DNF):</strong> onder ± 22 energie loopt de kans snel op dat een duif de vlucht niet uitrijdt — ze komt niet thuis, verdient geen punten of prijs, en is nadien vaak gekwetst. Bij bijna 0 energie komt ze zo goed als zeker niet thuis.</li>
          <li><strong>Blessurekans</strong> stijgt met de afstand én met lage energie. Voorbeeld op een fondvlucht van <strong>490 km</strong>: ± 11% bij volle energie, oplopend tot <strong>~19%</strong> als ze op haar tandvlees vliegt. Ruw weer verhoogt de kans nog wat.</li>
          <li><strong>Dood tijdens een wedstrijd:</strong> enkel wie een <em>zo goed als lege</em> duif (onder ± 5 energie) laat racen, riskeert dat ze het niet haalt (~7%). Uitgeruste duiven lopen dit risico niet.</li>
        </ul>
        <p><strong>Strategie:</strong> race nooit een uitgeputte duif. Het levert amper punten op én riskeert een blessure of erger — laat haar eerst herstellen.</p>
      </Section>

      <Section id="broeden" icon="🥚" title="Kans op broeden">
        <p className="muted" style={{ marginTop: 0 }}>
          Een koppel levert <strong>niet gegarandeerd</strong> jongen op. De <strong>libido</strong> én de
          <strong> energie</strong> van béide ouders bepalen de kans.
        </p>
        <ul>
          <li><strong>Sterk koppel</strong> (hoge libido, goede energie): bijna altijd raak, met een goede kans op een <strong>tweede</strong> jong.</li>
          <li><strong>Zwak koppel</strong> (laag libido of lage energie): kan met lege handen achterblijven — een echt lusteloos koppel slaagt maar in zowat <strong>1 op 5</strong> van de pogingen.</li>
          <li>Een tweede jong komt er alleen bij <strong>hoge libido</strong> (tot ± 70% kans op een tweede).</li>
        </ul>
        <p><strong>Strategie:</strong> koppel duiven met <em>hoge libido en goede energie</em>, en zet <em>Libido-mix</em> voer in tijdens de kweekperiode.</p>
      </Section>

      <Section id="ziekte" icon="🤒" title="Kans op ziekte">
        <p className="muted" style={{ marginTop: 0 }}>
          Elke dag is er een kleine kans dat een gezonde duif ziek wordt. Er zijn twee bronnen:
          <strong> besmetting</strong> (van een zieke, niet-geïsoleerde hokgenoot) en <strong>spontane ziekte</strong>
          (vooral bij verzwakte duiven).
        </p>
        <ul>
          <li><strong>Lage gezondheid én lage energie</strong> maken een duif veel kwetsbaarder. Met één zieke hokgenoot in de buurt: een fitte duif ± <strong>2% per week</strong>, een verzwakte duif ± <strong>13% per week</strong> — meer dan zes keer zoveel.</li>
          <li><strong>De ziekenboeg breekt de ketting:</strong> een zieke duif die daar geïsoleerd zit, besmet niemand en wordt zelf niet besmet.</li>
          <li>Een <strong>apart hok</strong> verlaagt de kans om ziek te worden.</li>
        </ul>
        <p><strong>Strategie:</strong> houd gezondheid en energie op peil, en zet een zieke duif <em>meteen</em> in de ziekenboeg om een uitbraak in je hok te voorkomen.</p>
      </Section>

      <Section id="sterfte" icon="🕯️" title="Sterfte">
        <p className="muted" style={{ marginTop: 0 }}>Een duif kan op drie manieren sterven:</p>
        <ul>
          <li><strong>Ouderdom:</strong> zo goed als nooit vóór ± 4 jaar; daarna loopt de kans op, en vanaf ± 8 jaar wordt het echt gevaarlijk. Duiven <strong>verouderen 4× sneller</strong> dan de echte tijd, dus ouderdom gaat over enkele maanden meespelen.</li>
          <li><strong>Onbehandelde aandoening:</strong> een matige of ernstige ziekte of blessure die je laat aanmodderen kan dodelijk aflopen. Een ernstig geval dat je z'n hele beloop negeert kost de duif zowat <strong>1 op 4</strong>; in de ziekenboeg zakt dat tot ± <strong>2%</strong>.</li>
          <li><strong>Vlucht:</strong> enkel een zo goed als lege duif (onder ± 5 energie) riskeert de dood tijdens een race.</li>
        </ul>
        <p><strong>Strategie:</strong> verzorg aandoeningen op tijd in de ziekenboeg, race geen uitgeputte duiven, en kweek tijdig opvolging voor je oudere kampioenen.</p>
      </Section>

      <Section id="rassen" icon="🎨" title="Rassen (breeds)">
        <p className="muted" style={{ marginTop: 0 }}>
          Elke duif heeft een <strong>ras</strong>. Dat is <strong>puur cosmetisch</strong> (het bepaalt haar foto) plus
          een klein prijskaartje bij zeldzamere rassen — het heeft <strong>geen enkel effect op prestaties</strong>.
        </p>
        <p>Bij een nieuwe duif wordt het ras willekeurig geloot, met deze kansen:</p>
        <MiniTable
          head={['Zeldzaamheid', 'Kans', 'Prijspremie']}
          rows={[
            ['Algemeen', '≈ 75%', '—'],
            ['Ongewoon', '≈ 21%', 'klein'],
            ['Zeldzaam', '≈ 2,4%', '+20%'],
            ['Legendarisch', '≈ 1,6%', '+40%'],
          ]}
        />
        <ul style={{ marginTop: 12 }}>
          <li>Kweek je twee duiven van <strong>hetzelfde ras</strong>, dan houdt het jong dat ras.</li>
          <li>Twee <strong>verschillende</strong> rassen geven een <strong>Gemengd</strong> jong.</li>
        </ul>
        <p><strong>Strategie:</strong> rariteit is puur geluk. Een legendarisch ras is een mooie verzamelaarsprijs en verkoopt wat duurder, maar maakt je duif geen greintje sneller.</p>
      </Section>

      <Section id="afscheid" icon="👋" title="Afscheid nemen van een duif">
        <p className="muted" style={{ marginTop: 0 }}>
          Wil je van een duif af, dan kan dat op <strong>twee manieren</strong> — allebei via de knop op de
          <strong> duifpagina</strong> (klik een duif aan in je hok). Een duif die ingeschreven staat voor een
          vlucht moet je eerst <em>uitschrijven</em>.
        </p>
        <ul>
          <li>
            <strong>🕊️ Vrijlaten</strong> — je laat de duif gaan. Ze verdwijnt uit je hok en je krijgt er
            <strong> niets</strong> voor terug. Geen bijwerkingen: de rest van je hok blijft ongemoeid.
          </li>
          <li>
            <strong>🍲 Verkopen aan Bistro De Laatste Vlucht</strong> — het lokale duivenrestaurant maakt er
            <strong> duivensoep</strong> van. Je krijgt een <strong>vast bedrag van €50</strong>, maar het heeft
            een prijs: het nieuws <strong>drukt de moraal</strong> van je hele hok. <strong>Elke andere duif
            verliest 1 tot 5 energie</strong> (willekeurig per duif) door de mentale klap.
          </li>
        </ul>
        <MiniTable
          head={['Manier', 'Opbrengst', 'Effect op de rest van je hok']}
          rows={[
            ['🕊️ Vrijlaten', '€0', 'geen'],
            ['🍲 Duivenrestaurant', '€50 (vast)', 'elke andere duif −1 tot −5 energie'],
          ]}
        />
        <p style={{ marginTop: 12 }}>
          <strong>Strategie:</strong> vrijlaten is het nettste als je gewoon plaats wil maken. Verkopen aan het
          restaurant geeft snel wat geld voor een duif die toch niets meer opbrengt, maar reken de
          energie-dip van je hele hok mee — doe het niet vlak voor een belangrijke vlucht.
        </p>
      </Section>

      <p className="muted" style={{ textAlign: 'center', fontSize: '0.9rem' }}>
        Onthoud: geluk zit overal in het spel. Deze cijfers helpen je slimmer kiezen — ze beslissen niets op voorhand.
      </p>
    </div>
  );
}
