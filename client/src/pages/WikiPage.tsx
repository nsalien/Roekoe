/**
 * Wiki — a strategy-oriented explainer of the game's key mechanics and odds.
 *
 * Deliberately NOT 100% transparent: it gives the numbers that shape a player's
 * strategy (energy costs, recovery, breeding/illness/injury/death odds, breed
 * rarity) in rounded, ballpark form, but keeps the exact hidden formulas and the
 * ever-present luck factor a mystery. Fully static/client-side — no backend, no
 * cost. Keep the figures in rough sync with core/config/gameConfig.ts by hand.
 */

import { useEffect } from 'react';

const SECTIONS = [
  { id: 'starterspakket', icon: '🎁', label: 'Starterspakket' },
  { id: 'genen', icon: '🧬', label: 'Genen & training' },
  { id: 'coach', icon: '🎯', label: 'Privécoach' },
  { id: 'ervaring', icon: '🎓', label: 'Ervaring' },
  { id: 'energie', icon: '⚡', label: 'Energie, voer & rust' },
  { id: 'vlucht', icon: '🏁', label: 'Energie per vlucht' },
  { id: 'eigenschappen', icon: '📋', label: 'Wat doet elke eigenschap?' },
  { id: 'verdwalen', icon: '🧭', label: 'Verdwalen' },
  { id: 'vorm', icon: '🎯', label: 'Vluchtvorm & blessures' },
  { id: 'lage-energie', icon: '🪫', label: 'Lage energie' },
  { id: 'sponsors', icon: '🤝', label: 'Sponsors' },
  { id: 'titan', icon: '🏆', label: 'Titanenwedstrijd' },
  { id: 'estafette', icon: '🔗', label: 'Estafettevlucht' },
  { id: 'criterium', icon: '🏆', label: 'Leeftijdscriterium' },
  { id: 'broeden', icon: '🥚', label: 'Kweken & broeden' },
  { id: 'ziekte', icon: '🤒', label: 'Ziekte' },
  { id: 'ziekenboeg', icon: '🏥', label: 'De ziekenboeg' },
  { id: 'sterfte', icon: '🕯️', label: 'Sterfte' },
  { id: 'rassen', icon: '🎨', label: 'Rassen' },
  { id: 'veilingen', icon: '🔨', label: 'Veilingen & bieden' },
  { id: 'hok', icon: '🏠', label: 'Hok & onderhoudskosten' },
  { id: 'waarde', icon: '💰', label: 'Wat is een duif waard?' },
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
  // Arriving from another page with a hash (e.g. a "Hoe de schijven werken →"
  // link on Mijn hok): the router renders this page but does not scroll to the
  // anchor itself, so do it once the sections are mounted.
  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (id) document.getElementById(id)?.scrollIntoView();
  }, []);

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

      <Section id="starterspakket" icon="🎁" title="Starterspakket voor nieuwe spelers">
        <p className="muted" style={{ marginTop: 0 }}>
          Wie instapt in een club die al draait, vliegt tegen duiven die al weken getraind en
          gecoacht zijn. Daarom krijgt elke nieuwe speler een <strong>starterspakket</strong>: twee
          tegoeden die je <strong>zelf verdeelt</strong>, en vier voordelen die <strong>28 dagen</strong>
          (één seizoen) lopen.
        </p>
        <p><strong>Tegoeden — deze vervallen niet.</strong></p>
        <MiniTable
          head={['Tegoed', 'Hoeveel', 'Waar het heen mag']}
          rows={[
            ['🎓 Ervaring', '30 punten', 'allemaal naar één duif naar keuze'],
            ['💪 Eigenschappen', '5 punten', 'vrij over duiven én over snelheid/conditie/oriëntatie'],
          ]}
        />
        <p>
          <strong>Waarom ervaring naar één duif?</strong> Ervaring telt drie keer mee — sneller
          vliegen, energie beter doseren en minder verbruik per vlucht. Alles op één duif zetten
          levert je één echte kanshebber op in plaats van zes duiven die net iets minder kansloos
          zijn. Je krijgt de volle 30 punten: de leerfactor die een routinier afremt geldt hier niet.
        </p>
        <p>
          Eigenschapspunten respecteren <strong>wel</strong> het genetisch plafond van je duif. Zit ze
          nog maar 2 onder haar cap, dan landen er 2 punten en houd je de rest over voor een andere duif.
        </p>
        <p><strong>Voordelen gedurende 28 dagen.</strong></p>
        <MiniTable
          head={['Voordeel', 'Wat het doet']}
          rows={[
            ['🎯 Gratis privécoach', 'je eerste gecoachte duif kost niets; een tweede betaal je gewoon'],
            ['💰 Dubbele winst', 'op wedstrijdvluchten: 2× prijzengeld én 2× ranglijstpunten'],
            ['⚡ Volle duiven', 'je startduiven beginnen op 100 energie, dus met een groene vluchtvorm'],
            ['🤝 Eerste sponsor', 'er ligt meteen een aanbod klaar van een kleine sponsor'],
          ]}
        />
        <p className="faint">
          Je startgeld blijft €5.000, net als bij iedereen. Na 28 dagen stoppen de vier voordelen
          hierboven en krijg je daar een <strong>melding</strong> van — je coach kost dan weer €80 per
          dag en je wint weer enkelvoudig. Punten die je nog niet uitgaf blijven gewoon van jou.
        </p>
      </Section>

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

      <Section id="coach" icon="🎯" title="De privécoach">
        <p className="muted" style={{ marginTop: 0 }}>
          Een privécoach werkt voor <strong>één duif</strong>. Hij traint haar <strong>elke dag</strong> in snelheid,
          conditie én oriëntatie (plus wat ervaring) — puur om te racen, nooit libido. Er is <strong>geen
          instapkost</strong>: je betaalt enkel <strong>€80 per dag</strong> zolang hij in dienst is, automatisch van
          je kassa. Ontslaan kan op elk moment.
        </p>
        <p><strong>Hij duwt richting de gen-cap, en dooft daar uit.</strong> De dagwinst is het grootst bij een lage
          waarde en wordt kleiner naarmate een eigenschap haar plafond nadert; op de cap stopt ze helemaal. Elke
          eigenschap telt apart — een duif die op snelheid al capt, kan op oriëntatie nog vlot bijleren.</p>
        <MiniTable
          head={['Huidige waarde (cap 90)', 'Winst per dag', 'Tempo']}
          rows={[
            ['50', '≈ +0,5', 'vlot'],
            ['70', '≈ +0,25', 'trager'],
            ['85', '≈ +0,06', 'traag'],
            ['90 (op de cap)', '0', 'gestopt'],
          ]}
        />
        <ul style={{ marginTop: 12 }}>
          <li><strong>Enkel de coach gaat boven 90.</strong> Zelf trainen stopt op 80, vluchten op 90 — voor de laatste
            punten tot de gen-cap is hij de enige weg (zie <a href="#genen">Genen &amp; training</a>).</li>
          <li><strong>Hij werkt niet terwijl de duif vliegt</strong> — een duif die de hele dag onderweg is, leert die
            dag niets van hem bij.</li>
          <li><strong>Zijn ervaringswinst volgt de leerfactor</strong> (<a href="#ervaring">Ervaring</a>): bij een
            groentje bijna een punt per dag, bij een veteraan nog een fractie.</li>
          <li><strong>Op de duifpagina staat het exacte cijfer</strong> voor déze duif, per eigenschap per dag — zit
            alles al op de cap, dan zegt de pagina dat een coach niets meer toevoegt.</li>
        </ul>
        <p><strong>Strategie:</strong> €80/dag is ± €560 per week — dat is echt geld. Zet een coach op duiven die
          genetisch nog ruimte hebben (zeker boven 90, waar niets anders werkt) en ontsla hem zodra de winst tot
          bijna niets herleid is. Op een duif die al op haar cap zit, verbrand je puur budget.</p>
      </Section>

      <Section id="ervaring" icon="🎓" title="Ervaring: snel geleerd, traag vervolmaakt">
        <p className="muted" style={{ marginTop: 0 }}>
          Ervaring <strong>maakt een duif niet sneller</strong> — daarvoor is er snelheid. Ze maakt haar
          <strong>zuinig</strong>: minder energie per vlucht, vlotter herstel, en een lage tank die ze beter
          weet in te delen. Ze groeit door te <strong>vliegen</strong>, te <strong>trainen</strong> en met
          een <strong>privécoach</strong> — maar niet aan een vast tempo.
        </p>
        <p>
          Dat indelen is <strong>voorwaardelijk</strong>: een duif met een volle tank heeft er niets aan,
          een lege duif veel. Wat ervaring 0 → 100 oplevert op een vlucht van 500 km:
        </p>
        <MiniTable
          head={['Energie van je duif', 'Winst uit ervaring']}
          rows={[
            ['100 (volle tank)', 'niets'],
            ['70', '+5 km/u'],
            ['40', '+10 km/u'],
            ['20 (bijna leeg)', '+15 km/u'],
          ]}
        />
        <p>
          <strong>Een groentje leert snel, een routinier amper nog.</strong> Elke vlucht en elke
          trainingsbeurt levert dezelfde duif <em>minder</em> op naarmate ze al meer ervaring heeft. De
          eerste helft gaat vlot, de laatste punten zijn een echte grind:
        </p>
        <MiniTable
          head={['Ervaring van de duif', 'Wat een vlucht opbrengt', 'Tempo']}
          rows={[
            ['0 – 30 (groentje)', 'bijna dubbel zoveel als vroeger', 'zeer snel'],
            ['± 35', 'ongeveer zoals vroeger', 'normaal'],
            ['± 50', 'ongeveer twee derde', 'trager'],
            ['± 70', 'ongeveer een derde', 'traag'],
            ['90+ (veteraan)', 'nog een tiende', 'grind'],
          ]}
        />
        <ul style={{ marginTop: 12 }}>
          <li><strong>Een verre vlucht leert nog steeds meer</strong> dan een korte — de rangorde blijft, alleen het tempo zakt.</li>
          <li><strong>Het blijft altijd vooruitgaan.</strong> Ook een duif op 95 pikt nog iets op; het duurt gewoon lang.</li>
          <li><strong>De coach helpt mee</strong>, maar zijn dagelijkse ervaringswinst krimpt op dezelfde manier. Op de duifpagina staat wat hij voor <em>déze</em> duif per dag oplevert.</li>
        </ul>
        <p>
          <strong>Strategie:</strong> laat je jonge duiven vroeg en vaak meevliegen — dan is hun ervaring
          in enkele weken opgebouwd. Bij een duif die al ver zit, koop je met een extra vlucht nauwelijks
          nog ervaring bij: die zet je beter in wanneer het écht telt.
        </p>
      </Section>

      <Section id="energie" icon="⚡" title="Energie, voer & rust">
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

        <h3 style={{ marginBottom: 4 }}>Voorraad: elk voertype apart</h3>
        <p className="muted" style={{ marginTop: 0 }}>
          <strong>Elke duif eet van haar eigen voertype</strong> (in te stellen bij <em>Mijn hok</em> of op de
          duifpagina), en elk type heeft een <strong>aparte voorraad</strong> die je op het overzicht bijkoopt. Is de
          voorraad van één type op, dan lijden precies die duiven honger — de rest van je hok merkt er niets van.
        </p>
        <MiniTable
          head={['Voer', 'Prijs/kg', 'Terugkoop/kg', 'Verbruik/duif/dag']}
          rows={[
            ['Normaal', '€3', '€2,40', '≈ 0,14 kg'],
            ['Premium', '€6', '€4,80', '≈ 0,21 kg'],
            ['Libido-mix', '€4,5', '€3,60', '≈ 0,20 kg'],
            ['Herstelvoer', '€3', '€2,40', '≈ 0,21 kg'],
          ]}
        />
        <p style={{ marginTop: 10 }}>
          <strong>Te veel gekocht? Je kan voer terugverkopen.</strong> Dezelfde balie op het overzicht schakelt met één
          klik naar <em>Verkopen</em>, en de knop <em>Alles</em> zet er meteen je hele voorraad van dat type in. De
          voerhandelaar betaalt <strong>80%</strong> van de aankoopprijs terug, dus je maakt op een verkoop{' '}
          <strong>altijd een klein verlies</strong>. Voer is daarom geen spaarpot: 100 kg Premium kopen en meteen
          terugverkopen kost je €120.
        </p>

        <h3 style={{ marginBottom: 4 }}>Honger: de gevaarlijkste fout</h3>
        <p className="muted" style={{ marginTop: 0 }}>
          Geen voorraad = geen eten, en dat wordt <strong>elke dag erger</strong>: de daling versnelt zolang er niets
          bijkomt. <strong>Getrainde vaardigheden</strong> (snelheid/conditie/oriëntatie) blijven ongemoeid — honger
          vreet enkel energie, gezondheid en libido, maar kan wél dodelijk zijn.
        </p>
        <MiniTable
          head={['Dag zonder eten', 'Energie', 'Gezondheid', 'Sterftekans']}
          rows={[
            ['1', '−8', '−5', 'geen'],
            ['2', '−16', '−10', 'geen'],
            ['3', '−24', '−15', '± 25%'],
            ['4', '−32', '−20', '± 50%'],
            ['7', '—', '—', 'zeker'],
          ]}
        />
        <p style={{ marginTop: 12 }}>Koop je bij, dan springt de teller meteen terug op 0 en herstelt ze weer normaal.</p>

        <h3 style={{ marginBottom: 4 }}>Rustkuur: tijd omzetten in vorm</h3>
        <ul style={{ marginTop: 0 }}>
          <li><strong>€300 voor twee volle dagen rust.</strong> Daarna in één keer <strong>+40 energie</strong> en
            <strong> +15 gezondheid</strong> — de snelste weg terug naar een groene vluchtvorm.</li>
          <li>Tijdens de kuur kan de duif <strong>niets</strong>: niet vliegen, trainen of koppelen.</li>
          <li><strong>Elke duif mag op kuur</strong>, en gerust meerdere tegelijk — maar <strong>elke duif maar één keer
            per week</strong>. Die teller loopt per duif, vanaf de start van haar vorige kuur.</li>
          <li>Geen kuur voor een duif die al ingeschreven staat, of die al vol energie én gezondheid zit.</li>
        </ul>
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

      <Section id="sponsors" icon="🤝" title="Sponsors: wat ze opbrengen">
        <p className="muted" style={{ marginTop: 0 }}>
          Een sponsor betaalt je op <strong>twee manieren</strong>: een vast bedrag <strong>elke dag</strong>, en een
          <strong> podiumpremie</strong> telkens een van je duiven bij de eerste drie eindigt. Het dagbedrag staat naast
          je dagelijkse kosten in de <strong>dagbalans</strong> op het overzicht.
        </p>
        <MiniTable
          head={['Tier', 'Per dag', 'Podiumpremie (1e nationaal)']}
          rows={[
            ['1 — buurtsponsor', '€25 – €40', '€50 – €70'],
            ['2 — lokale zaak', '€45 – €70', '€85 – €120'],
            ['3 — grote speler', '€90 – €135', '€145 – €215'],
            ['4 — prestige', '€150 – €200', '€235 – €310'],
          ]}
        />
        <p style={{ marginTop: 12 }}>
          <strong>De premie hangt af van de vlucht én van je plaats.</strong> Een sponsor heeft er meer aan dat zijn
          logo bij een internationale zege hangt dan bij een regiovlucht, dus hij betaalt in verhouding tot het
          prestige — net zoals het prijzengeld zelf:
        </p>
        <MiniTable
          head={['Niveau', '1e plaats', '2e plaats', '3e plaats']}
          rows={[
            ['Regionaal', '×0,6', '×0,36', '×0,21'],
            ['Nationaal', '×1,0', '×0,6', '×0,35'],
            ['Internationaal', '×1,8', '×1,08', '×0,63'],
          ]}
        />
        <p style={{ marginTop: 12 }}>
          Voorbeeld met drie buurtsponsors samen (basis €185): een <strong>regionale derde plaats €40</strong>, een
          <strong> nationale zege €185</strong>, een <strong>internationale zege €330</strong>. Zet je meerdere duiven in
          en pakken ze 1-2-3, dan krijg je alle drie de premies.
        </p>
        <ul>
          <li>Enkel <strong>wedstrijdvluchten</strong> tellen: een oefenvlucht, de titanenwedstrijd en de
            estafettevlucht leveren <strong>geen</strong> sponsorgeld op.</li>
          <li>Je kan <strong>meerdere sponsors</strong> tegelijk hebben, maar per categorie maar één.</li>
          <li>Presteer je een heel seizoen fors minder, dan kan een sponsor er zelf mee stoppen.</li>
          <li><strong>Nee is nee bij een slechtere concurrent.</strong> Weiger je een sponsor uit een categorie
            waar je er al één hebt (overstappen kost een verbrekingsvergoeding) en betaalt hij <strong>niet
            meer</strong> dan die, dan komt hij <strong>nooit meer terug</strong> — je zou immers betalen om er
            op achteruit te gaan. Biedt de concurrent wél méér, dan klopt hij later gewoon opnieuw aan.</li>
        </ul>
        <p><strong>Strategie:</strong> een portefeuille sponsors dekt een flink deel van je dagelijkse kosten, en de
          premie maakt de zware internationale vluchten extra de moeite. Grote sponsors komen enkel op je af ná een
          podium — dus goed presteren betaalt zichzelf dubbel terug.</p>
      </Section>

      <Section id="titan" icon="🏆" title="De titanenwedstrijd (om de week, zaterdag)">
        <p className="muted" style={{ marginTop: 0 }}>
          De zaterdagwedstrijd wisselt week na week: de ene week de <strong>titanenwedstrijd</strong>, de andere week
          de <a href="#estafette">estafettevlucht</a>. Welke er aankomt, zie je op de vluchtkalender. De titan vraagt
          je <strong>beste duif</strong>, de estafette de <em>diepte</em> van je hok — samen dwingen ze je dus twee
          verschillende hokken te bouwen.
        </p>
        <ul>
          <li><strong>Eén duif per hok.</strong> Geen tactiek met aantallen: je zet je kampioen in, of niets.</li>
          <li><strong>Middellange tot lange afstand</strong> (± 200 – 600 km). Inschrijfgeld <strong>€50</strong>.</li>
          <li>Deze wedstrijd <strong>vervangt die dag alle andere vluchten</strong>.</li>
        </ul>
        <MiniTable
          head={['Plaats', 'Prijzengeld']}
          rows={[['1e', '€1.800'], ['2e', '€1.200'], ['3e', '€900']]}
        />
        <ul style={{ marginTop: 12 }}>
          <li><strong>Enkel geld.</strong> Geen seizoenspunten en geen medailles, dus de titan beweegt de
            melkerranglijst (de Roekoe) <strong>niet</strong>. Er kan ook niet op gewed worden, en sponsors betalen er
            geen podiumpremie voor.</li>
          <li><strong>De duivenranglijsten (de Vleugel) tellen hem wél volwaardig mee</strong>: snelheid, podiums en
            vooruitgang van je duif tellen gewoon.</li>
          <li>Je duif gaat er, zoals bij elke vlucht, gewoon op vooruit.</li>
        </ul>
        <p><strong>Strategie:</strong> €1.800 voor één start is de rijkste enkele prijs van de week, maar je hebt maar
          één schot. Kijk naar de <a href="#vorm">vluchtvorm</a> van je kampioen: op zaterdag met een duif die vrijdag
          nog vloog, gooi je je beste kans weg.</p>
      </Section>

      <Section id="estafette" icon="🔗" title="De estafettevlucht (om de week, zaterdag)">
        <p className="muted" style={{ marginTop: 0 }}>
          Zaterdag wisselt de prestigewedstrijd af: de ene week de <strong>titanenwedstrijd</strong> (één topduif),
          de andere week de <strong>estafettevlucht</strong> — één ploeg van <strong>drie</strong> duiven die elkaar
          aflossen over zowat 900 km. De titan vraagt je beste duif, de estafette vraagt <em>diepte</em>.
        </p>
        <ul>
          <li>De route wordt in <strong>drie exact gelijke etappes</strong> gesneden (± 300 km elk). Er is altijd maar
            <strong> één duif tegelijk</strong> in de lucht; op elk wisselpunt neemt de volgende over.</li>
          <li>Elke duif betaalt enkel de energie van <strong>haar eigen etappe</strong> (± 25) — per duif dus lichter
            dan één solo-fondvlucht, maar je zet er wel drie tegelijk voor in.</li>
          <li><strong>Eén schakel weg = ploeg weg.</strong> Geeft een duif op of raakt ze er niet, dan is de hele ploeg
            uitgeschakeld. Duiven die nog niet aan de beurt waren, vliegen dan gewoon niet (en verliezen niets).</li>
          <li>Elke etappe heeft <strong>haar eigen weer</strong>, en dat weerbericht staat er dagen op voorhand bij.
            Daarom mag je je volgorde tot de start nog wisselen.</li>
          <li>Inschrijfgeld <strong>€100 voor de hele ploeg</strong> (niet per duif). Haal je één duif weg, dan is je
            hele ploeg uitgeschreven en krijg je dat geld terug.</li>
          <li>Enkel <strong>prijzengeld</strong> (top 5), geen seizoenspunten en geen weddenschappen. De snelheid van je
            duiven op hun etappe telt wél mee voor de duivenranglijsten.</li>
        </ul>
        <MiniTable
          head={['Plaats', 'Prijzengeld']}
          rows={[['1e', '€3.000'], ['2e', '€2.000'], ['3e', '€1.500'], ['4e', '€1.100'], ['5e', '€800']]}
        />
        <p style={{ marginTop: 12 }}>
          <strong>Uitslag:</strong> eerst de ploegen die <em>compleet</em> thuis raken, op tijd. Daarna de uitgeschakelde
          ploegen, op hoe ver ze geraakt zijn — die kunnen dus nog in de prijzen vallen, maar nooit vóór een ploeg die
          het wél haalde.
        </p>
        <p><strong>Strategie:</strong> zet je sterkste duif op de <em>zwaarste</em> etappe (die met tegenwind) — daar
          verlies je met haar het minst. Bij overal hetzelfde weer maakt de volgorde niets uit. En kijk vooral naar je
          <em> zwakste</em> schakel: die bepaalt evenveel van de ploegtijd als je kampioen.</p>
      </Section>

      <Section id="criterium" icon="🏆" title="Het leeftijdscriterium (elke week, per leeftijdsklasse)">
        <p className="muted" style={{ marginTop: 0 }}>
          Naast het gewone seizoen loopt er een tweede competitie, alleen voor <strong>duiven</strong>. Er zijn vier
          leeftijdsklassen, en elke klasse krijgt <strong>één eigen vlucht per week</strong> waar enkel duiven van die
          leeftijd in mogen. Zo moet je jonge duif niet meteen tegen doorwinterde routiniers, en heeft een oude
          kampioen nog altijd haar eigen wedstrijd.
        </p>
        <MiniTable
          head={['Klasse', 'Leeftijd', 'Vluchtdag']}
          rows={[
            ['🐣 Onder 1 jaar', 'tot 1 jaar', 'maandag 06:00'],
            ['🕊️ 1 tot 2 jaar', '1 – 2 jaar', 'woensdag 06:00'],
            ['🦅 2 tot 3 jaar', '2 – 3 jaar', 'donderdag 06:00'],
            ['🏅 Ouder dan 3 jaar', 'vanaf 3 jaar', 'vrijdag 06:00'],
          ]}
        />
        <ul style={{ marginTop: 12 }}>
          <li><strong>Inschrijven kost €20</strong>, en je mag er <strong>zoveel duiven in zetten als je wil</strong>
            — zolang ze in de juiste leeftijdsklasse vallen. In welke klasse een duif zit, staat op haar
            <strong> duifpagina</strong>; bij het inschrijven toont de lijst enkel de duiven die mogen.</li>
          <li>De vlucht <strong>wisselt week na week</strong> tussen een <strong>🏁 sprint</strong> (100 – 300 km) en
            een <strong>🛰️ grote fond</strong> (400 – 1000 km). Alle vier de klassen vliegen dezelfde week hetzelfde
            format, dus per seizoen zijn dat 2 sprints en 2 fondvluchten per klasse.</li>
          <li>Verder is het een <strong>gewone wedstrijd</strong>: normale energiekost, normale kans op een blessure,
            en je duif gaat er gewoon op vooruit.</li>
        </ul>
        <h3>Prijzengeld per vlucht</h3>
        <MiniTable
          head={['Plaats', '🏁 Sprint', '🛰️ Grote fond']}
          rows={[
            ['1e', '€1.000', '€1.600'],
            ['2e', '€800', '€1.400'],
            ['3e', '€600', '€1.200'],
            ['4e', '€420', '€850'],
            ['5e', '€300', '€600'],
            ['6e', '€200', '€400'],
            ['7e', '€130', '€260'],
            ['8e', '€80', '€160'],
          ]}
        />
        <h3>De stand loopt drie seizoenen</h3>
        <p>
          Eén vlucht per klasse per week is maar vier resultaten per seizoen — veel te weinig om een veld te scheiden.
          Daarom telt de criteriumstand <strong>drie seizoenen</strong> door (12 weken, dus 6 sprints en 6 fondvluchten)
          voor er een prijsuitreiking en een reset volgt. Punten krijg je met dezelfde tabel als een gewone vlucht
          (100 voor de winnaar, 80, 65, …) — <strong>een sprint en een fondvlucht wegen even zwaar</strong>, alleen het
          geld verschilt.
        </p>
        <MiniTable
          head={['Plaats na 3 seizoenen', 'Prijs']}
          rows={[['🥇 1e', '€2.000 + gouden titel'], ['🥈 2e', '€1.600 + zilveren titel'], ['🥉 3e', '€1.200 + bronzen titel']]}
        />
        <p style={{ marginTop: 12 }}>
          Het geld gaat naar de <strong>eigenaar</strong>, maar de <strong>titel komt op de duif zelf</strong> te staan
          — die blijft bij haar, ook als je haar later verkoopt.
        </p>
        <h3>Wat het níet doet</h3>
        <p>
          Het criterium is een <strong>aparte rangschikking</strong>. Er zijn <strong>geen seizoenspunten</strong>, geen
          medailles en geen overwinningen voor je hok, er is geen sponsorpremie en je kan er niet op wedden: de
          melkerranglijst (de Roekoe) beweegt er dus <em>niet</em> door. Voor de gewone <strong>duivenranglijsten</strong>
          (snelheid, podiums, vooruitgang) telt de vlucht wél mee, net als de titanenwedstrijd.
        </p>
        <h3>Je duif wordt ouder — en klimt mee</h3>
        <p>
          Duiven verouderen vier keer sneller dan de echte klok, dus over een volledige cyclus van drie seizoenen wordt
          een duif bijna een jaar ouder. <strong>Haar klasse wordt bepaald op het moment dat je haar inschrijft.</strong>
          Groeit ze tijdens de cyclus uit haar klasse, dan blijven de punten die ze daar verdiende gewoon staan en begint
          ze bovendien punten te verzamelen in haar nieuwe klasse. Ze kan dus in twee standen tegelijk verschijnen.
        </p>
        <p><strong>Strategie:</strong> de klasse <em>onder 1 jaar</em> is de goedkoopste plek om een jong te laten
          rijpen — ze vliegt er tegen leeftijdsgenoten in plaats van tegen het hele veld. En omdat de stand drie
          seizoenen loopt, is <em>elke week meedoen</em> meer waard dan één keer schitteren: een duif die alle twaalf
          vluchten uitvliegt, verzamelt meer dan een kampioen die er de helft mist.</p>
      </Section>

      <Section id="eigenschappen" icon="📋" title="Wat doet elke eigenschap tijdens een vlucht?">
        <p className="muted" style={{ marginTop: 0 }}>
          Elke eigenschap heeft één duidelijke rol. Ze doen niet allemaal hetzelfde, en ze
          werken niet allemaal op je snelheid.
        </p>
        <MiniTable
          head={['Eigenschap', 'Wat ze doet', 'Waar ze het zwaarst weegt']}
          rows={[
            ['⚡ Snelheid', 'Rauw tempo. Bepaalt samen met conditie hoe snel je duif vliegt.', 'Korte vluchten (sprint)'],
            ['💪 Conditie', 'Dat tempo kunnen aanhouden. Bepaalt samen met snelheid je tempo.', 'Lange vluchten (fond)'],
            ['🧭 Oriëntatie', 'De weg vinden. Bepaalt of je duif omvliegt of de weg helemaal kwijtraakt.', 'Lange vluchten en slecht weer'],
            ['❤️ Gezondheid', 'Samen met energie je vluchtvorm: de kans op blessure en ziekte. Heel lage gezondheid maakt een duif zelfs niet-vluchtklaar.', 'Overal'],
            ['🔋 Energie', 'De tank. Samen met gezondheid je vluchtvorm; bij een bijna lege tank valt een duif uit of erger.', 'Overal, zwaarder op lange vluchten'],
            ['🎓 Ervaring', 'Zuiniger vliegen en sneller herstellen. Maakt niet sneller.', 'Vooral op een lage tank'],
          ]}
        />
      </Section>

      <Section id="verdwalen" icon="🧭" title="Verdwalen: waar oriëntatie voor dient">
        <p className="muted" style={{ marginTop: 0 }}>
          Oriëntatie is je navigatie-eigenschap. Ze bepaalt of ze rechtstreeks naar huis
          vliegt — of kilometers omvliegt en zelfs de weg helemaal kwijtraakt.
        </p>
        <p><strong>Kans dat een duif van koers raakt</strong> (mooi weer):</p>
        <MiniTable
          head={['Oriëntatie', '150 km', '300 km', '500 km', '700 km', '1000 km']}
          rows={[
            ['95', '0,4 %', '0,6 %', '0,7 %', '0,9 %', '1,2 %'],
            ['85', '1,0 %', '1,3 %', '1,8 %', '2,2 %', '2,8 %'],
            ['70', '3,4 %', '4,4 %', '5,7 %', '7,0 %', '9,0 %'],
            ['50', '9,7 %', '12,5 %', '16,2 %', '20,0 %', '25,6 %'],
            ['30', '19,8 %', '25,6 %', '33,3 %', '41,0 %', '52,5 %'],
          ]}
        />
        <ul style={{ marginTop: 12 }}>
          <li><strong>Hoe verder de vlucht, hoe groter de kans</strong> — meer kilometers betekent meer gelegenheid om af te dwalen.</li>
          <li>
            <strong>Slecht weer maakt het veel erger — maar niet voor iedereen.</strong> Mist,
            regen en harde wind verhogen de kans tot ~75 %. Op 700 km gaat een duif met
            oriëntatie 95 van 0,9 % naar 1,6 %, terwijl een duif met oriëntatie 30 van 41 %
            naar <strong>72 %</strong> springt. Een goede navigator merkt er dus nauwelijks
            iets van; een slechte is bij ruw weer nagenoeg kansloos.
          </li>
        </ul>
        <p style={{ marginTop: 12 }}>
          <strong>Wat het kost.</strong> Meestal vliegt ze gewoon een <strong>omweg</strong>:
          echte extra kilometers, dus echt tijdverlies, een forse val in de stand — én extra
          energie, want die kilometers moeten gevlogen worden.
        </p>
        <MiniTable
          head={['Oriëntatie', 'Omweg op 300 km', 'Omweg op 1000 km']}
          rows={[
            ['95', '~7 km', '~23 km'],
            ['70', '~11 km', '~38 km'],
            ['30', '~19 km', '~62 km'],
          ]}
        />
        <p style={{ marginTop: 12 }}>
          <strong>En soms raakt ze de weg helemaal kwijt.</strong> Dan komt ze die dag niet
          thuis. <strong>Je duif is nooit voorgoed weg</strong> — duiven vinden hun weg terug —
          maar het kan een paar dagen duren, en ze komt binnen met een <strong>lege tank, veel
          minder gezondheid</strong> en vaak een kwetsuur of ziekte. Zolang ze onderweg is kan
          ze niets: niet vliegen, trainen, koppelen of verkocht worden.
        </p>
        <MiniTable
          head={['Oriëntatie', 'Kans dat ze niet thuiskomt (300 km)', 'Idem (1000 km, slecht weer)']}
          rows={[
            ['95', 'praktisch nul', 'praktisch nul'],
            ['70', '0,02 %', '0,1 %'],
            ['50', '0,4 %', '1,4 %'],
            ['30', '2,6 %', '8,5 %'],
          ]}
        />
        <p style={{ marginTop: 12 }}>
          <strong>Oriëntatie groeit door te vliegen</strong>, en het snelst op <strong>lange
          vluchten</strong> — een duif die 900 km aflegt, leert de route kennen. Je kan haar ook
          trainen (tot 80) en een <strong>privécoach</strong> werkt er eveneens aan, tot haar
          genetische plafond.
        </p>
        <p>
          <strong>Strategie:</strong> zet een duif met zwakke oriëntatie op <strong>korte
          vluchten bij goed weer</strong> en bouw haar oriëntatie op met oefenvluchten en de
          coach. Voor de grote fond — zeker met slecht weer op komst — stuur je je beste
          navigators.
        </p>
      </Section>

      <Section id="vorm" icon="🎯" title="Vluchtvorm: waarom duiven geblesseerd raken">
        <p className="muted" style={{ marginTop: 0 }}>
          Blessures en ziektes zijn geen loterij meer. Ze hangen af van één cijfer dat je
          zelf stuurt: de <strong>vluchtvorm</strong> van je duif. Je ziet ze op de duifpagina
          en in de keuzelijst bij het inschrijven, met een 🟢/🟡/🔴-stip.
        </p>
        <p>
          <strong>Hoe ze berekend wordt.</strong> Vluchtvorm combineert <strong>energie</strong> en{' '}
          <strong>gezondheid</strong>, waarbij de <strong>laagste van de twee dubbel telt</strong>.
          Eén zwakke schakel wordt dus niet verstopt door de andere: een uitgeruste maar zieke duif
          is even kwetsbaar als een kerngezonde die op haar tandvlees zit.
        </p>
        <MiniTable
          head={['Energie / Gezondheid', 'Vluchtvorm', 'Beoordeling']}
          rows={[
            ['90 / 95', '≈ 92', '🟢 fris'],
            ['80 / 90', '≈ 83', '🟢 fris'],
            ['60 / 85', '≈ 68', '🟡 matig'],
            ['40 / 70', '≈ 50', '🔴 risico'],
            ['20 / 50', '≈ 30', '🔴 gevaarlijk'],
          ]}
        />

        <p style={{ marginTop: 14 }}>
          <strong>Twee soorten blessures.</strong> Niet elke blessure zegt iets over je verzorging:
        </p>
        <ul>
          <li>
            <strong>Overbelasting</strong> — verrekte borstspier, verstuikte vleugel,
            borstbeenkneuzing, botbreuk. Die krijg je omdat de inspanning te zwaar was voor
            de duif: <strong>hoe lager de vluchtvorm, hoe groter de kans</strong>, en hoe
            zwaarder het letsel uitvalt.
          </li>
          <li>
            <strong>Pech</strong> — een sperwer, een botsing, een afgebroken slagpen. Dat
            overkomt een topduif net zo goed als een sukkelaar: een <strong>kleine, vaste
            kans</strong> die je met geen enkele verzorging wegkrijgt. Bij een duif in
            topvorm is dít de reden dat ze toch eens gehavend thuiskomt.
          </li>
        </ul>
        <MiniTable
          head={['Vluchtvorm', '150 km', '300 km', '500 km', '1000 km']}
          rows={[
            ['90 (top)', '2 %', '3 %', '3 %', '5 %'],
            ['75 (goed)', '4 %', '5 %', '6 %', '9 %'],
            ['65 (normaal)', '7 %', '9 %', '11 %', '15 %'],
            ['45 (zwak)', '18 %', '21 %', '26 %', '38 %'],
            ['30 (gevaarlijk)', '30 %', '36 %', '44 %', '64 %'],
          ]}
        />
        <p className="muted" style={{ fontSize: '0.85rem' }}>
          Afstand telt nog mee, maar veel minder dan vroeger: een fitte duif kan de grote fond
          aan, een uitgeputte duif is zelfs op een regiovlucht een risico.
        </p>

        <p style={{ marginTop: 14 }}>
          <strong>Hoe erg wordt het?</strong> Bij overbelasting hangt ook de <em>ernst</em> van
          de vluchtvorm af — en dat scheelt dagen uitval (licht ≈ 1,5 dag met volle zorg,
          ernstig ≈ 6 dagen):
        </p>
        <MiniTable
          head={['Vluchtvorm', 'Licht', 'Matig', 'Ernstig']}
          rows={[
            ['90', '66 %', '26 %', '8 %'],
            ['70', '58 %', '28 %', '14 %'],
            ['50', '50 %', '30 %', '20 %'],
            ['30', '42 %', '32 %', '26 %'],
          ]}
        />

        <p style={{ marginTop: 14 }}>
          <strong>Twee dagen op rij vliegen kost je.</strong> Rust kan je niet kopen. Vloog je
          duif <strong>gisteren</strong>, dan gaat er <strong>15 vluchtvorm</strong> af;
          eergisteren nog 7. Een oefenvlucht telt maar voor een derde. In de praktijk{' '}
          <strong>verdubbelt dat haar blessurekans</strong> — ook als haar energiebalk er
          door goed voer weer prima uitziet. Je hoeft daar zelf niets mee te doen: het
          vormcijfer dat je op de duifpagina en bij het inschrijven ziet is
          <strong>al na die aftrek</strong>.
        </p>

        <p style={{ marginTop: 14 }}>
          <strong>Ziek worden werkt net zo.</strong> Dezelfde combinatie van energie en
          gezondheid bepaalt hoe vatbaar een duif is. Een kerngezond hok ziet zelden iets;
          een verwaarloosd hok gaat snel onderuit, en besmetting doet de rest:
        </p>
        <MiniTable
          head={['Vluchtvorm', 'Kans ziek te worden, per week']}
          rows={[
            ['90 (top)', '≈ 1 %'],
            ['75 (goed)', '≈ 3 %'],
            ['65 (normaal)', '≈ 5 %'],
            ['45 (zwak)', '≈ 14 %'],
            ['30 (gevaarlijk)', '≈ 24 %'],
          ]}
        />

        <p style={{ marginTop: 14 }}>
          <strong>Wat kost een wedstrijd aan gezondheid?</strong> Een race slijt je duif echt:
          ongeveer <strong>−2</strong> op een regiovlucht tot <strong>−7</strong> op de grote
          fond, en <strong>extra als ze leeg thuiskomt</strong>. Gezondheid komt vanzelf terug
          met voer (het snelst met <em>Herstelvoer</em>, en sneller naarmate ze verder gezakt
          is), maar één à twee wedstrijden per week is wat een duif duurzaam aankan.
        </p>

        <p>
          <strong>Strategie:</strong> kijk naar de stip, niet naar de energiebalk alleen. Zet een
          🔴-duif niet in — zeker niet op een lange vlucht. Wil je er toch een snel klaarstomen,
          dan is de <strong>rustkuur</strong> (2 dagen, +40 energie én +15 gezondheid) de
          snelste weg terug naar groen. Elke duif mag er op — ook meerdere tegelijk — maar
          <strong> elke duif maar één keer per week</strong>.
        </p>
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

      <Section id="broeden" icon="🥚" title="Kweken & broeden">
        <p className="muted" style={{ marginTop: 0 }}>
          Koppelen kost <strong>€200</strong> en <strong>−15 energie per ouder</strong>. Beide ouders hebben minstens
          <strong> 20 energie</strong> nodig, mogen niet ziek of gekwetst zijn, niet in de ziekenboeg zitten en niet
          ingeschreven staan voor een vlucht. Een broedende duif <strong>kan niet vliegen</strong> — stop het koppel
          als je haar terug wil inzetten (het vervalt dan zonder jongen).
        </p>
        <p><strong>Wat een jong erft:</strong> elke vaardigheid is het <strong>gemiddelde van beide ouders ± een
          mutatie</strong> (tot ±8), begrensd op haar eigen gen-cap. Ook de <a href="#genen">genen</a> zelf — de
          plafonds én het verouderingstempo — erven zo over. Twee ouders van hetzelfde <a href="#rassen">ras</a> geven
          dat ras door; verschillende ouders geven een <em>Gemengd</em> jong.</p>
        <p><strong>Uitkomen duurt onvoorspelbaar lang.</strong> Er is geen aftelklok: elk moment is er een kans, groter
          naarmate libido en energie van de ouders hoger zijn. Een topfit koppel komt gemiddeld na ± 1 dag uit, een
          lusteloos koppel kan tot ± 6 dagen duren.</p>
        <p style={{ marginTop: 12 }}>
          <strong>Een koppel levert niet gegarandeerd jongen op.</strong> De <strong>libido</strong> én de
          <strong> energie</strong> van béide ouders bepalen de kans.
        </p>
        <ul>
          <li><strong>Sterk koppel</strong> (hoge libido, goede energie): bijna altijd raak, met een goede kans op een <strong>tweede</strong> jong.</li>
          <li><strong>Zwak koppel</strong> (laag libido of lage energie): kan met lege handen achterblijven — een echt lusteloos koppel slaagt maar in zowat <strong>1 op 5</strong> van de pogingen.</li>
          <li>Een tweede jong komt er alleen bij <strong>hoge libido</strong> (tot ± 70% kans op een tweede).</li>
        </ul>
        <p><strong>Strategie:</strong> koppel duiven met <em>hoge libido en goede energie</em>, en zet <em>Libido-mix</em> voer in tijdens de kweekperiode.</p>
        <p style={{ marginTop: 12 }}>
          <strong>Zit je hok vol wanneer de jongen uitkomen? Dan kies jij.</strong> Er gaat niets verloren: het hele
          nest blijft op de Kweek-pagina wachten tot je beslist hebt. Je ziet van elk jong de score én de{' '}
          <a href="#genen">gen-caps</a>, en je houdt er zoveel als je wil — <strong>alles, een deel of niets</strong>.
        </p>
        <ul>
          <li>Wat je <strong>niet</strong> kiest, vliegt weg. Dat brengt niets op.</li>
          <li>
            <strong>Plaats maken</strong> kan meteen vanuit hetzelfde scherm: laat een duif vrij (€0) of verkoop haar
            aan het duivenrestaurant (vast bedrag, maar een <em>moraalklap</em> voor je hele hok).
          </li>
          <li>Zolang een nest op je keuze wacht, kan je <strong>geen nieuw koppel</strong> starten.</li>
          <li>Er is <strong>geen tijdslimiet</strong> — een nest verloopt nooit.</li>
        </ul>
      </Section>

      <Section id="ziekte" icon="🤒" title="Kans op ziekte">
        <p className="muted" style={{ marginTop: 0 }}>
          Elke dag is er een kans dat een duif ziek wordt. Er zijn twee bronnen: <strong>besmetting</strong> (van een
          zieke, niet-geïsoleerde hokgenoot) en <strong>spontane ziekte</strong>. Gezondheid en energie zijn veruit de
          grootste factor — maar geen schild: <strong>ook een kerngezonde duif wordt af en toe eens ziek</strong>, net
          als een mens. Het verschil zit in hoe vaak.
        </p>
        <MiniTable
          head={['Hok van 8 duiven', 'Eerste ziektegeval na…', 'Besmetting binnen een week']}
          rows={[
            ['Kerngezond', '± 110 dagen', '20%'],
            ['Goed verzorgd', '± 90 dagen', '37%'],
            ['Normaal', '± 60 dagen', '57%'],
            ['Verwaarloosd', '± 17 dagen', '80%'],
          ]}
        />
        <p style={{ marginTop: 12 }}>
          <strong>Hoe erg de ziekte is, hangt óók van de gezondheid af.</strong> Een duif in goede doen sleept meestal
          iets lichts op; een verzwakte duif is degene die iets zwaars oploopt.
        </p>
        <MiniTable
          head={['Gezondheid', 'Licht', 'Matig', 'Ernstig']}
          rows={[
            ['80 of hoger', '55%', '33%', '12%'],
            ['55', '47%', '34%', '19%'],
            ['30', '40%', '34%', '26%'],
          ]}
        />
        <ul style={{ marginTop: 12 }}>
          <li><strong>De ziekenboeg breekt de ketting:</strong> een zieke duif die daar geïsoleerd zit, besmet niemand en wordt zelf niet besmet.</li>
          <li>Een <strong>apart hok</strong> verlaagt de kans om ziek te worden.</li>
          <li>Een ernstige ziekte blijft altijd mogelijk, ook bij een topduif — ze is alleen zeldzaam.</li>
        </ul>
        <p><strong>Strategie:</strong> houd gezondheid en energie op peil, en zet een zieke duif <em>meteen</em> in de ziekenboeg — anders is de kans groot dat het overslaat op de rest van je hok.</p>
      </Section>

      <Section id="ziekenboeg" icon="🏥" title="De ziekenboeg: personeel & herstel">
        <p className="muted" style={{ marginTop: 0 }}>
          De ziekenboeg doet twee dingen: ze <strong>zondert een zieke duif af</strong> (zo besmet ze niemand en wordt
          ze zelf niet besmet) en ze <strong>versnelt het herstel</strong>. Ze start met <strong>2 bedden</strong>,
          uitbreidbaar tot 6. Duiven in de boeg kunnen niet vliegen, trainen of kweken.
        </p>
        <MiniTable
          head={['Verzorging', 'Kost/dag', 'Wat het doet']}
          rows={[
            ['💊 Medicinaal voer', '€6 per duif in de boeg', 'sneller herstel voor iedereen in de boeg'],
            ['🩺 Duivendokter', '€57', 'behandelt 2 zieke duiven'],
            ['🦴 Duivenkinesist', '€50', 'behandelt 2 gekwetste duiven'],
          ]}
        />
        <p style={{ marginTop: 12 }}>
          <strong>Hoe lang duurt genezen?</strong> Rustend in het gewone hok gaat het traag; de effecten van de
          ziekenboeg, de juiste staf en medicinaal voer <em>stapelen</em>:
        </p>
        <MiniTable
          head={['Ernst', 'Enkel rustend in het hok', 'Met volle zorg']}
          rows={[
            ['Licht', '± 5 dagen', '± 1,5 dag'],
            ['Matig', '± 11 dagen', '± 3,5 dagen'],
            ['Ernstig', '± 18 dagen', '± 6 dagen'],
          ]}
        />
        <ul style={{ marginTop: 12 }}>
          <li><strong>Meer patiënten dan plaatsen? Jij kiest.</strong> Eén dokter behandelt er maar 2. Met de knop
            <strong> 📌 Deze duif laten behandelen</strong> zet je zelf iemand vast; de overige plaatsen vult het spel
            automatisch met de <em>ernstigste</em> gevallen. Kies je niets, dan gaat alles automatisch — precies zoals
            vroeger. Een tweede dokter of kinesist geeft er telkens twee plaatsen bij.</li>
          <li><strong>Energie herstelt er trager.</strong> Een duif in de boeg krijgt maar <strong>50 %</strong> van het
            normale voer-herstel, en <strong>enkel als ze door de juiste staf gedekt is</strong> (dokter bij ziekte,
            kinesist bij een kwetsuur). Ongedekt krijgt ze er <strong>niets</strong> bij. De rustbonus telt er ook niet.</li>
          <li><strong>Een apart hok komt vrij</strong> zodra een duif naar de boeg gaat, en ze pakt het automatisch
            terug bij haar genezing als er nog eentje vrij is.</li>
          <li><strong>Elke 12 uur</strong> krijg je per herstellende duif een statusbericht met het herstelpercentage
            en een schatting hoe lang het nog duurt.</li>
        </ul>
        <p><strong>Strategie:</strong> personeel kost geld per dag, maar een onbehandelde ernstige aandoening kost je
          soms de duif (zie <a href="#sterfte">Sterfte</a>) én ondermijnt intussen elke dag haar gezondheid. Neem staf
          in dienst zolang je patiënten hebt, en ontsla ze weer als de boeg leeg is.</p>
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

      <Section id="veilingen" icon="🔨" title="Veilingen: bieden, slotfase & anti-snipe">
        <p className="muted" style={{ marginTop: 0 }}>
          Elke <strong>zondag van 11u tot 20u</strong> gaat er <strong>één</strong> topduif onder de hamer —
          nooit meerdere tegelijk, zodat iedereen om dezelfde duif vecht. Daarnaast duikt er af en toe een
          duif uit het <strong>opvangcentrum</strong> op (maar niet terwijl de zondagveiling loopt).
        </p>

        <p><strong>Bieden gebeurt in twee fases:</strong></p>
        <MiniTable
          head={['Tijd tot het einde', 'Wat mag je?']}
          rows={[
            ['meer dan 30 minuten', 'onbeperkt bieden, zo vaak je wil'],
            ['laatste 30 minuten (slotfase)', 'nog maximaal 3 biedingen per speler, op deze duif'],
            ['laatste 5 minuten', 'elk bod zet de klok terug op 5 minuten'],
          ]}
        />

        <ul style={{ marginTop: 12 }}>
          <li>
            <strong>Je ziet je tegoed staan.</strong> Zodra de slotfase begint, toont de veilingkaart hoeveel
            van je 3 biedingen je al gebruikt hebt en hoeveel er nog over zijn. Zijn ze op, dan kan je op
            deze duif niet meer bieden — ook niet als iemand je daarna overbiedt.
          </li>
          <li>
            <strong>De klok terugzetten kost je een bod.</strong> Een bod in de laatste 5 minuten verlengt de
            veiling wel, maar telt gewoon mee voor je drie. Eindeloos rekken lukt dus niet.
          </li>
          <li>
            <strong>Winnen op de valreep bestaat niet.</strong> Omdat elk laat bod de klok terugzet naar
            5 minuten, krijgen de anderen altijd de kans om terug te bieden.
          </li>
        </ul>

        <p>
          <strong>Strategie:</strong> nibbelen met het minimumbedrag werkt niet meer. Met nog drie biedingen
          te gaan zet je best meteen een stevige stap — of gewoon je échte maximum. Wie tot het laatste
          moment blijft plakken met kleine verhogingen, is door zijn biedingen heen vóór de veiling sluit.
        </p>
        <p className="faint" style={{ fontSize: '0.85rem' }}>
          Waarom deze regel? Zo eindigt een veiling in een handvol duidelijke stappen in plaats van tientallen
          kleine — dat is spannender én het houdt het spel snel voor iedereen.
        </p>
      </Section>

      <Section id="hok" icon="🏠" title="Hokcapaciteit & onderhoudskosten">
        <p className="muted" style={{ marginTop: 0 }}>
          Je hok bepaalt hoeveel duiven je kan houden — en dus hoeveel je er per week aan de
          start kan brengen. Het is daarmee de sterkste troef in het spel, en bewust een
          <strong> investering van lange adem</strong>: uitbreiden wordt snel duurder, én elke
          extra duif kost je daarna méér onderhoud per dag.
        </p>
        <p>
          <strong>Uitbreiden.</strong> Je start met plaats voor <strong>8</strong> duiven en
          groeit in stappen van twee:
        </p>
        <MiniTable
          head={['Stap', 'Prijs', 'Cumulatief vanaf 8']}
          rows={[
            ['8 → 10', '€1.500', '€1.500'],
            ['10 → 12', '€3.500', '€5.000'],
            ['12 → 14', '€10.000', '€15.000'],
            ['14 → 16', '€17.500', '€32.500'],
            ['16 → 18', '€30.000', '€62.500'],
            ['18 → 20', '€50.000', '€112.500'],
          ]}
        />
        <p style={{ marginTop: 14 }}>
          <strong>Onderhoud gaat in schijven.</strong> Hoe groter je hok, hoe duurder elke
          extra duif. Het werkt zoals belastingschijven: <strong>élke duif betaalt het tarief
          van háár schijf</strong>, nooit het toptarief op je hele hok.
        </p>
        <MiniTable
          head={['Schijf', 'Per duif per dag']}
          rows={[
            ['duif 1 – 8', '€2'],
            ['duif 9 – 12', '€6'],
            ['duif 13 – 16', '€12'],
            ['duif 17 – 20', '€20'],
          ]}
        />
        <p style={{ marginTop: 14 }}>
          Samen met de vaste basiskost van €22/dag komt dat neer op:
        </p>
        <MiniTable
          head={['Duiven', 'Per dag', 'Per week']}
          rows={[
            ['8', '€38', '€266'],
            ['10', '€50', '€350'],
            ['12', '€62', '€434'],
            ['14', '€86', '€602'],
            ['16', '€110', '€770'],
            ['18', '€150', '€1.050'],
            ['20', '€190', '€1.330'],
          ]}
        />
        <ul style={{ marginTop: 12 }}>
          <li><strong>Een hok van 8 betaalt niets extra</strong> — de schijven raken alleen wie groter gaat.</li>
          <li><strong>Je ziet het per schijf terug</strong> in de <em>Dagbalans</em> op het Overzicht, naast je sponsorinkomsten.</li>
          <li><strong>Voer, aparte hokken en de ziekenboeg staan hier los van</strong> en worden apart aangerekend.</li>
          <li>Op de uitbreidingskaart in <em>Mijn hok</em> zie je de tarieven <strong>vóór</strong> je een uitbreiding koopt.</li>
        </ul>
        <p>
          <strong>Strategie:</strong> een groter hok verdient zichzelf alleen terug als je die
          duiven ook echt laat vliegen. Een duif kan door haar energie zowat één wedstrijd per
          4 à 7 dagen aan — reken dus uit hoeveel starts je per week realistisch invult voor je
          €50.000 aan de laatste twee plaatsen uitgeeft. Een kleiner, goed uitgerust hok is
          vaak winstgevender dan een vol hok dat half staat te niksen.
        </p>
      </Section>

      <Section id="waarde" icon="💰" title="Wat is een duif waard? De markt beslist">
        <p className="muted" style={{ marginTop: 0 }}>
          De <strong>geschatte waarde</strong> bij een duif is geen vaste formule meer. Ze wordt
          bepaald door <strong>wat spelers echt betalen</strong>. Elke afgeronde verkoop — op de markt,
          via een privébod of onder de veilinghamer — wordt onthouden samen met het talent van die duif,
          en dat vormt de prijslijst van de club.
        </p>

        <ul>
          <li>
            <strong>Vergelijkbare duiven bepalen de prijs.</strong> Ging er een duif van talent 70 weg
            voor €7.000, dan schuiven alle duiven in die buurt mee omhoog.
          </li>
          <li>
            <strong>Recente verkopen wegen zwaarder.</strong> Het gewicht van een verkoop halveert elke
            10 dagen en na 4 weken telt ze niet meer mee. Prijzen kunnen dus <strong>van week tot week
            verschillen</strong>, net als op een echte markt.
          </li>
          <li>
            <strong>Waar niet op geboden wordt, is weinig waard.</strong> Gaan zwakke duiven voor een
            habbekrats van de hand, dan zakt de schatting voor dat soort duiven mee — tot enkele
            tientjes.
          </li>
          <li>
            <strong>Een betere duif is nooit minder waard</strong> dan een mindere. Ook als er in een
            bepaalde klasse toevallig één koopje voorbijkwam, blijft de rangorde kloppen.
          </li>
          <li>
            <strong>Zonder verkopen valt ze terug op een schatting</strong> op basis van talent, genen,
            leeftijd en ervaring. Op de duifpagina staat erbij hoe de prijs tot stand kwam: hoeveel
            procent markt, en op hoeveel verkopen dat gebaseerd is.
          </li>
        </ul>

        <p>
          <strong>Wat je ermee doet:</strong> de waarde is een <em>richtprijs</em>, geen verplichting —
          je mag je duif voor elk bedrag te koop zetten. Ze bepaalt wel het <strong>startbod van de
          veilingen</strong> (30 % van de waarde, zodat er nog te bieden valt) en wat de gladde koopman
          in een dilemma voor je pronkstuk neerlegt.
        </p>
        <p className="faint" style={{ fontSize: '0.85rem' }}>
          Wil je de prijzen zien bewegen? Kijk naar de <strong>verkoopgeschiedenis</strong> op de markt:
          dat is letterlijk de data waarop de schattingen draaien.
        </p>
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
