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
import { Link } from 'react-router-dom';

const SECTIONS = [
  { id: 'nieuw', icon: '🧰', label: 'Nieuw: leagues, tags, duivenlokker & meer' },
  { id: 'seizoen3', icon: '🎉', label: 'Nieuw in seizoen 3' },
  { id: 'starterspakket', icon: '🎁', label: 'Starterspakket' },
  { id: 'genen', icon: '🧬', label: 'Genen & training' },
  { id: 'coach', icon: '🎯', label: 'Privécoach' },
  { id: 'ervaring', icon: '🎓', label: 'Ervaring' },
  { id: 'energie', icon: '⚡', label: 'Energie, voer & rust' },
  { id: 'vlucht', icon: '🏁', label: 'Energie per vlucht' },
  { id: 'eigenschappen', icon: '📋', label: 'Wat doet elke eigenschap?' },
  { id: 'verdwalen', icon: '🧭', label: 'Verdwalen' },
  { id: 'een-per-dag', icon: '🗓️', label: 'Eén vlucht per dag' },
  { id: 'prijzengeld', icon: '💶', label: 'Prijzengeld' },
  { id: 'tribune', icon: '💬', label: 'De tribune' },
  { id: 'lokaal', icon: '🍻', label: 'Het Lokaal (chat)' },
  { id: 'stem', icon: '🗳️', label: 'De Stem' },
  { id: 'vorm', icon: '🎯', label: 'Vluchtvorm & blessures' },
  { id: 'lage-energie', icon: '🪫', label: 'Lage energie' },
  { id: 'sponsors', icon: '🤝', label: 'Sponsors' },
  { id: 'titan', icon: '🏆', label: 'Titanenwedstrijd' },
  { id: 'estafette', icon: '🔗', label: 'Estafettevlucht' },
  { id: 'leagues', icon: '🏅', label: 'Leagues' },
  { id: 'broeden', icon: '🥚', label: 'Kweken & broeden' },
  { id: 'samen-kweken', icon: '🤝', label: 'Samen kweken' },
  { id: 'inteelt', icon: '🌳', label: 'Stamboom & inteelt' },
  { id: 'ziekte', icon: '🤒', label: 'Ziekte' },
  { id: 'ziekenboeg', icon: '🏥', label: 'De ziekenboeg' },
  { id: 'hygiene', icon: '🧹', label: 'Hokhygiëne & stro' },
  { id: 'inrichting', icon: '🛠️', label: 'Hokinrichting, vaccins & diensten' },
  { id: 'sterfte', icon: '🕯️', label: 'Sterfte' },
  { id: 'kenmerken', icon: '✨', label: 'Kenmerken' },
  { id: 'rassen', icon: '🎨', label: 'Rassen' },
  { id: 'veilingen', icon: '🔨', label: 'Veilingen & bieden' },
  { id: 'hok', icon: '🏠', label: 'Hok & onderhoudskosten' },
  { id: 'schuld', icon: '🔴', label: 'Rode cijfers & gedwongen veiling' },
  { id: 'waarde', icon: '💰', label: 'Wat is een duif waard?' },
  { id: 'afscheid', icon: '👋', label: 'Afscheid nemen' },
  { id: 'duivenlokker', icon: '🧲', label: 'Duivenlokker' },
  { id: 'tags', icon: '🏷️', label: 'Tags op je duiven' },
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

      <Section id="nieuw" icon="🧰" title="Nieuw: leagues, tags, duivenlokker, samen kweken & meer">
        <p className="muted" style={{ marginTop: 0 }}>
          Wat er in oktober (seizoen 3) bijkwam en veranderde, op één plek. Deze sectie blijft staan als logboek.
        </p>

        <h3>🏅 De leagues, in plaats van het leeftijdscriterium</h3>
        <p>
          Het leeftijdscriterium is weg. In de plaats komen <strong>vier leagues volgens de algemene score (★)</strong>{' '}
          van je duif: ★ t/m 60 op maandag, ★ 61–70 op woensdag, ★ 71–80 op donderdag en ★ 81+ op vrijdag, telkens om
          06:00. Zo vliegt een zwakkere duif tegen haar gelijken en kan ook zij iets winnen. Een league gaat pas door
          met minstens <strong>3 melkers en 4 duiven</strong>, en de stand loopt <strong>één seizoen</strong>.{' '}
          <a href="#leagues">Alles over de leagues →</a>
        </p>

        <h3>🏷️ Tags op je duiven</h3>
        <p>
          Geef je duiven je <strong>eigen labels</strong>, zoals <em>sprint</em>, <em>mid-fond</em> of{' '}
          <em>lange-fond</em>: op de pagina van een duif tik je <em>Tag toevoegen</em>. Je ziet ze daarna in{' '}
          <em>Mijn hok</em> en bij het <strong>inschrijven</strong> op de Vluchten-pagina, achter de naam van elke duif.
          Enkel jij ziet ze, en bij verkoop verdwijnen ze. <a href="#tags">Alles over tags →</a>
        </p>

        <h3>🧲 De duivenlokker (15 oktober)</h3>
        <p>
          Een idee van De Stem: <em>vrijgelate duifjes zoeken een nieuw nest</em>. Bij <em>Inrichting → Uitrusting</em>{' '}
          koop je een <strong>duivenlokker</strong> (€500) en waardeer je hem op tot <strong>niveau 5</strong>. Laat een{' '}
          <strong>andere speler</strong> een duif vrij, dan maakt elke lokker kans om haar te vangen — hoe hoger het
          niveau, hoe groter de kans. Vangt de jouwe er een, dan kies je bij <em>Kweek</em> of je haar houdt. Een
          vrijgelaten duif kan dus bij een concurrent belanden: denk even na voor je vrijlaat.{' '}
          <a href="#duivenlokker">Alles over de duivenlokker →</a>
        </p>

        <h3>🤝 Samen kweken (12 oktober)</h3>
        <p>
          Kweek met de duif van een <strong>andere speler</strong>, zonder dat er een duif
          van eigenaar verandert. Bij <em>Kweek → Samen kweken</em> bied je een gezonde duif aan en kies je meteen of je
          <strong> de jongen</strong> wil of <strong>de vergoeding</strong>, plus wat een partner minstens moet hebben.
          Wie een duif voorstelt, ziet de <strong>geschatte score en marktwaarde van het jong</strong>; daarna spreken jullie
          enkel het bedrag af. Bij een akkoord betaalt elk <strong>€1.000</strong> en start het nest — zoals elk nest kan
          het even duren en is een jong niet gegarandeerd. Een aangeboden of voorgestelde duif blijft thuis.
          Enkel tussen echte spelers: de computermelkers doen niet mee.{' '}
          <a href="#samen-kweken">Alles over samen kweken →</a>
        </p>

        <h3>💉 Vaccins en verzekering per duif</h3>
        <p>
          Dit stond niet in de aankondiging van 11 oktober: je hoeft niet altijd het hele hok te behandelen. Op de pagina
          van <strong>elke duif</strong> staat de kaart <em>Verzorging &amp; verzekering</em>. Daar geef je haar apart een
          <strong> vaccin of kuur</strong> (na een vaccin mag ze 2 dagen niet vliegen, een kuur houdt haar niet aan de grond)
          en <strong>verzeker</strong> je haar: sterft ze, dan krijg je een deel van haar marktwaarde terug. De premie
          betaal je per dag en staat in je Dagbalans. <a href="#inrichting">Wanneer de verzekering uitbetaalt →</a>
        </p>

        <h3>🧰 De pagina Inrichting</h3>
        <p>
          Een nieuwe pagina in het menu met alles wat je aan je hok koopt, in vier blokken die je openklapt:{' '}
          <strong>plaatsen &amp; hokken</strong>, <strong>hygiëne</strong> (vers stro en een hokpoetser),{' '}
          <strong>vaccins &amp; kuren</strong> en <strong>uitrusting</strong> (dakventilatie, buitenren,
          roofvogelafweer, kunstlicht, infrarood nestbakken, betere reismanden, weerstation). Elk onderdeel geeft een
          klein voordeel; pas alles samen maakt een echt verschil. <strong>Niets kopen = het spel zoals je het
          kende</strong>: een hok zonder stro staat op hygiëne 50 en merkt niets.
        </p>
        <ul>
          <li>Hokcapaciteit en aparte hokken koop je nu op <em>Inrichting</em> in plaats van op <em>Mijn hok</em> (ziekenboegbedden kan het daar ook).</li>
          <li>Uitrusting koop je één keer en waardeer je op tot niveau 4. Enkel de hokpoetser, het vakblad en de
            verzekeringspremies kosten per dag; ze staan in je Dagbalans.</li>
          <li>De <strong>verzekering</strong> sluit je af op de pagina van een duif, het <strong>vakblad</strong> vind je op de Markt.</li>
          <li>Bots kopen vers stro en dakventilatie, verder niets.</li>
        </ul>
        <p><a href="#hygiene">Hygiëne &amp; de hokpoetser →</a> · <a href="#inrichting">Uitrusting, vaccins &amp; verzekering →</a></p>

        <h3>🕊️ Het hokoverzicht</h3>
        <p>
          Bovenaan <em>Mijn hok</em> staat waar elke duif zit: de bezette en vrije plaatsen, de aparte hokken, wie
          broedt, wie in de ziekenboeg ligt (en hoe ver ze hersteld is), wie beschermd is en wie niet thuis is (vliegt
          of is de weg kwijt).
        </p>

        <h3>📌 Zoekertje naar boven</h3>
        <p>
          Op de Markt zet je je eigen zoekertje voor <strong>€50</strong> bovenaan. Het blijft <strong>12 uur</strong>{' '}
          bovenaan, tenzij iemand anders intussen het zijne naar boven haalt: dan zakt het jouwe terug naar zijn gewone
          plaats. Een prijswijziging houdt je plek; uit de verkoop halen of verkopen beëindigt ze.{' '}
          <a href="#waarde">Meer over de Markt →</a>
        </p>

        <h3>🦠 Besmetting per ziekte</h3>
        <p>
          Een zieke duif buiten de ziekenboeg geeft nu <strong>haar eigen ziekte</strong> door aan haar hokgenoten
          (vroeger kreeg een besmette duif een willekeurige ziekte), en de ene ziekte slaat veel makkelijker over dan de
          andere: paramyxovirose het snelst, salmonellose het traagst. Zet een zieke duif dus meteen in de ziekenboeg;
          lukt dat niet, dan beschermt een kuur of vaccin tegen díe ziekte de rest van je hok.{' '}
          <a href="#ziekte">Kans per ziekte →</a>
        </p>

        <h3>⚖️ Wat er verandert zonder dat je iets koopt</h3>
        <ul>
          <li>De besmetting per ziekte hierboven.</li>
          <li>Alle bescherming tegen ziekte samen (apart hok, hygiëne, hokpoetser, IJzeren gestel) maakt de kans nooit
            kleiner dan <strong>×0,4</strong> van wat ze zonder zou zijn. Een duif met een apart hok én IJzeren gestel
            zat op ×0,35; dat wordt ×0,4.</li>
          <li>In de kweek heet het nu <em>nest</em> en <em>broeden</em> in plaats van <em>koppelen</em>; de werking is dezelfde.</li>
        </ul>
      </Section>

      <Section id="seizoen3" icon="🎉" title="Nieuw in seizoen 3">
        <p className="muted" style={{ marginTop: 0 }}>
          Alles wat er bij de start van seizoen 3 veranderde, op één plek. Deze pagina blijft staan als logboek.
        </p>

        <h3>✨ Kenmerken <span className="faint" style={{ fontWeight: 400 }}>— het winnende idee uit De Stem</span></h3>
        <p>
          Ongeveer <strong>één duif op drie</strong> heeft nu een kenmerk: +5 % snelheid in haar eigen situatie (weer,
          temperatuur, afstand, licht of donker, gezelschap), of een passief voordeel (minder verdwalen, minder energie,
          minder ziek). Van de duiven met een kenmerk heeft ≈ 80 % een gewoon en ≈ 20 % een zeldzaam kenmerk.
          Kenmerken zijn <strong>erfelijk</strong> en voor iedereen zichtbaar. <a href="#kenmerken">Alle 15 kenmerken →</a>
        </p>

        <h3>🤝 Sponsors</h3>
        <ul>
          <li>Je kan hoogstens <strong>6 sponsors</strong> tegelijk hebben. Een zevende tekenen = eerst een andere
            opzeggen (met de gewone verbrekingsvergoeding).</li>
          <li>De prestigesponsors (tier 4) betalen <strong>de helft per dag</strong>; tekengeld en podiumpremie
            blijven gelijk. (Bij de start was het even een kwart; dat is verdubbeld.)</li>
          <li>Had je er bij de update meer dan 6? Dan kies je gratis welke je laat gaan — tot dan betaalt geen enkele
            sponsor uit.</li>
        </ul>
        <MiniTable
          head={['Prestigesponsor', 'Per dag (was)', 'Per dag (nu)']}
          rows={[
            ['📡 Telecom Vleugelnet', '€165', '€85'],
            ['🎰 De Gouden Ring', '€150', '€75'],
            ['🏆 Formule Duif Racing', '€200', '€100'],
          ]}
        />
        <p><a href="#sponsors">Meer over sponsors →</a></p>

        <h3>🎓 Coach &amp; trainen</h3>
        <p>
          Een privécoach kost nu per dag volgens de <strong>algemene score</strong> van de duif (was: altijd €80). De
          gratis starterscoach dekt je duurste duif. Zelf trainen geeft voortaan altijd precies <strong>+1</strong>.
        </p>
        <MiniTable
          head={['Score', 'Coach per dag']}
          rows={[
            ['onder 65', '€80'],
            ['65 – 70', '€100'],
            ['70 – 75', '€140'],
            ['75 – 80', '€180'],
            ['80 – 85', '€220'],
            ['85 – 90', '€300'],
            ['90 en meer', '€400'],
          ]}
        />
        <p><a href="#coach">Meer over de privécoach →</a></p>

        <h3>❤️ Gezondheid</h3>
        <p>Een vlucht kost <strong>15 % meer gezondheid</strong> dan vroeger. Met een volle tank:</p>
        <MiniTable
          head={['Vlucht', 'Was', 'Nu']}
          rows={[
            ['300 km', '−1,7', '−2,0'],
            ['500 km', '−2,5', '−2,9'],
            ['1000 km', '−4,5', '−5,2'],
          ]}
        />
        <p className="faint">Met een lege tank wordt het tot dubbel zoveel — rust loont dus meer.</p>

        <h3>⚡ Energie <span className="faint" style={{ fontWeight: 400 }}>— al live sinds eind september</span></h3>
        <p>
          Vliegen kost <strong>15 % meer energie</strong>, en ervaring spaart nog maar <strong>±6 %</strong> energie
          uit (was ±25 %). Gemiddeld verbruik op een vlucht van 500 km:
        </p>
        <MiniTable
          head={['Ervaring', 'Was', 'Nu']}
          rows={[
            ['0', '≈ 38', '≈ 38'],
            ['50', '≈ 32', '≈ 36'],
            ['100', '≈ 25', '≈ 35'],
          ]}
        />
        <p><a href="#vlucht">Meer over energie per vlucht →</a></p>

        <h3>🏆 Prijsuitreiking</h3>
        <p>
          De Roekoes zijn nu <strong>€2.000 / €1.700 / €1.400</strong>. Elke andere melker met seizoenspunten krijgt een
          <strong> seizoenspremie</strong> van zijn punten ÷ 3 in euro (1.200 punten → €400).
        </p>

        <h3>🔨 Zondagveiling</h3>
        <p>
          Voortaan <strong>twee topduiven</strong> op zondag: één met score 60–70 (10:00–20:00) en één met score 70–80
          (11:00–21:00). Om op beide te bieden heb je twee vrije plaatsen in je hok nodig.{' '}
          <a href="#veilingen">Meer over veilingen →</a>
        </p>

        <h3>📜 Erfenis</h3>
        <p>Kies je bij de erfenis van een oude melker de spaarpot, dan krijg je nu <strong>€2.000</strong> (was €600).</p>

        <h3>🗳️ Van De Stem</h3>
        <p>
          “Unieke eigenschappen per duif” staat op <em>In het spel</em>. Stem mee op het volgende idee:{' '}
          <Link to="/stem">naar De Stem →</Link>
        </p>
      </Section>

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
          instapkost</strong>: je betaalt enkel een <strong>dagloon</strong> zolang hij in dienst is, automatisch van
          je kassa. Ontslaan kan op elk moment.
        </p>
        <p><strong>Een betere duif vraagt een betere coach.</strong> Het dagloon hangt af van de algemene score van de
          duif, en wordt elke dag opnieuw bepaald: stijgt ze over een grens, dan betaal je vanaf de volgende dag meer.</p>
        <MiniTable
          head={['Algemene score', 'Coach per dag']}
          rows={[
            ['lager dan 65', '€80'],
            ['65 tot 70', '€100'],
            ['70 tot 75', '€140'],
            ['75 tot 80', '€180'],
            ['80 tot 85', '€220'],
            ['85 tot 90', '€300'],
            ['90 en hoger', '€400'],
          ]}
        />
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
        <p><strong>Strategie:</strong> een coach op een topduif kost ± €2.000–2.800 per week — dat is echt geld. Zet een coach op duiven die
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
          Hoe verder de vlucht, hoe meer energie ze kost. <strong>Ervaring verlaagt het verbruik een beetje</strong> —
          een geroutineerde duif doet iets zuiniger, een groentje verbruikt iets meer (±6%). De afstand weegt veel zwaarder.
        </p>
        <MiniTable
          head={['Afstand', 'Verbruik (gemiddelde duif)', 'Onervaren', 'Ervaren']}
          rows={[
            ['± 300 km', '≈ 29 energie', '≈ 30', '≈ 27'],
            ['± 500 km', '≈ 36 energie', '≈ 38', '≈ 35'],
            ['± 1000 km (grote fond)', '≈ 56 energie', '≈ 59', '≈ 53'],
          ]}
        />
        <ul style={{ marginTop: 12 }}>
          <li>Het verbruik wordt <strong>geleidelijk tijdens de vlucht</strong> afgetrokken; geeft een duif onderweg op, dan spaart ze de rest van haar energie.</li>
          <li>Een grote-fondvlucht kan een uitgeruste tank zowat helemaal leegtrekken — reken op enkele dagen herstel nadien.</li>
        </ul>
        <p><strong>Strategie:</strong> zet je <em>best uitgeruste</em> duiven op de verste vluchten — een volle tank weegt daar zwaarder dan ervaring. Een halflege duif op 1000 km is vragen om problemen.</p>
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
            ['4 — prestige', '€75 – €100', '€235 – €310'],
          ]}
        />
        <p style={{ marginTop: 10 }}>
          <strong>Hoe krijg je een sponsor?</strong> Na elke competitievlucht waaraan je deelnam, kan er een sponsor
          aankloppen: ≈ 50 % kans na een zege, 25 % na een podium en <strong>10 % na gewoon deelnemen</strong>. Welke
          sponsors interesse hebben, hangt af van je prestaties <strong>of</strong> van je spelersniveau: tier 1 meteen,
          tier 2 vanaf niveau 3, tier 3 vanaf niveau 6, tier 4 vanaf niveau 10. Hoogstens één nieuw aanbod per 6 uur.
        </p>
        <p className="notice" style={{ marginTop: 10 }}>
          ⚠️ <strong>Hoogstens 6 sponsors tegelijk.</strong> Wil je een zevende, dan zeg je er eerst een op — dat kost
          de gewone verbrekingsvergoeding. Overstappen naar een concurrent in dezelfde categorie blijft gewoon kunnen.
          De prestigesponsors (tier 4) betalen sinds seizoen 3 per dag de helft van vroeger; hun tekengeld en
          podiumpremie bleven. Weiger je een sponsor uit een <strong>hogere tier</strong> dan je huidige in die
          categorie, dan mag hij later gewoon terugkomen.
        </p>
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

      <Section id="leagues" icon="🏅" title="De leagues (elke week, per score)">
        <p className="muted" style={{ marginTop: 0 }}>
          Naast het gewone seizoen loopt er een tweede competitie, alleen voor <strong>duiven</strong>. Er zijn vier
          leagues volgens de <strong>algemene score (★)</strong> van een duif, en elke league krijgt{' '}
          <strong>één eigen vlucht per week</strong> waar enkel duiven met die score in mogen. Zo vliegt een duif van
          ★55 tegen andere duiven van haar niveau in plaats van tegen een ★85 — en kan ook een zwakkere duif iets
          winnen. (Vroeger was dit het leeftijdscriterium, per leeftijd.)
        </p>
        <MiniTable
          head={['League', 'Score', 'Vluchtdag']}
          rows={[
            ['🌱 ★ t/m 60', '★60 of lager', 'maandag 06:00'],
            ['🌿 ★ 61–70', '★60,1 tot en met ★70', 'woensdag 06:00'],
            ['🌳 ★ 71–80', '★70,1 tot en met ★80', 'donderdag 06:00'],
            ['👑 ★ 81+', '★80,1 of hoger', 'vrijdag 06:00'],
          ]}
        />
        <ul style={{ marginTop: 12 }}>
          <li><strong>Inschrijven kost €20</strong>, en je mag er <strong>zoveel duiven in zetten als je wil</strong>
            — zolang hun score in die league valt. Zoals overal verdienen per vlucht enkel je <strong>3 best
            geplaatste</strong> duiven.</li>
          <li><strong>De score telt op het moment dat je inschrijft.</strong> De score heeft één decimaal: ★60,0 hoort
            nog in de laagste league, ★60,1 al in ★ 61–70. Stijgt je duif na het inschrijven (coach, training), dan
            vliegt ze die vlucht nog gewoon in de league waarvoor je haar inschreef.</li>
          <li>Een league gaat pas door met <strong>minstens 4 duiven van minstens 3 verschillende melkers</strong>{' '}
            aan de start — zo valt er altijd minstens één duif naast het podium, en pakt niemand het podium tegen één
            enkele tegenstander. Zijn er minder, dan wordt de vlucht afgelast en krijgt iedereen zijn inschrijfgeld
            terug. De bots doen mee, en tellen ook als melker.</li>
          <li>De vlucht <strong>wisselt week na week</strong> tussen een <strong>🏁 sprint</strong> (100 – 300 km) en
            een <strong>🛰️ grote fond</strong> (400 – 1000 km): week 1 en 3 van een seizoen een sprint, week 2 en 4 een
            fond. Alle vier de leagues vliegen dezelfde week hetzelfde format.</li>
          <li>Verder is het een <strong>gewone wedstrijd</strong>: normale energiekost, normale kans op een blessure,
            en je duif gaat er gewoon op vooruit.</li>
        </ul>
        <h3>Prijzengeld per vlucht</h3>
        <p className="faint" style={{ marginTop: 0 }}>
          Hoe hoger de league, hoe meer: de laagste betaalt de helft van de hoogste, ★ 61–70 70 % en ★ 71–80 85 %.
          De volledige tabellen staan bij <a href="#prijzengeld">Prijzengeld</a>.
        </p>
        <MiniTable
          head={['Zege', '★ t/m 60', '★ 61–70', '★ 71–80', '★ 81+']}
          rows={[
            ['🏁 Sprint', '€500', '€700', '€850', '€1.000'],
            ['🛰️ Grote fond', '€800', '€1.120', '€1.360', '€1.600'],
          ]}
        />
        <h3>De stand loopt één seizoen</h3>
        <p>
          Punten krijg je met dezelfde tabel als een gewone vlucht (100 voor de winnaar, 80, 65, …) —{' '}
          <strong>een sprint en een fondvlucht wegen even zwaar</strong>, alleen het geld verschilt. Bij een gelijke
          stand beslissen het aantal zeges en daarna de beste gemiddelde snelheid. Op het einde van het seizoen wint de{' '}
          <strong>top 10 van elke league</strong> geld, en de <strong>top 3</strong> ook een titel:
        </p>
        <MiniTable
          head={['Plaats', '★ t/m 60', '★ 61–70', '★ 71–80', '★ 81+']}
          rows={[
            ['🥇 1e', '€800', '€1.100', '€1.350', '€1.600'],
            ['🥈 2e', '€650', '€900', '€1.100', '€1.300'],
            ['🥉 3e', '€500', '€650', '€800', '€950'],
            ['4e', '€200', '€300', '€350', '€400'],
            ['5e', '€150', '€200', '€250', '€300'],
            ['6e', '€100', '€150', '€200', '€250'],
            ['7e – 10e', '€75', '€100', '€125', '€150'],
          ]}
        />
        <p style={{ marginTop: 12 }}>
          Het geld gaat naar de <strong>eigenaar</strong>, maar de <strong>titel komt op de duif zelf</strong> te staan
          (bv. <em>Gouden Leagueduif ★ 61–70</em>) — die blijft bij haar, ook als je haar later verkoopt. Plaats 4 tot
          10 krijgt een <strong>leaguepremie</strong>: enkel geld, geen titel. Daarna gaat elke leaguestand terug op nul.
        </p>
        <h3>Wat het níet doet</h3>
        <p>
          De leagues zijn een <strong>aparte rangschikking</strong>. Er zijn <strong>geen seizoenspunten</strong> en
          geen overwinningen voor je hok, er is geen sponsorpremie en je kan er niet op wedden: de melkerranglijst (de
          Roekoe) beweegt er dus <em>niet</em> door. Een podium levert wél een <strong>medaille</strong> op, en voor de
          gewone <strong>duivenranglijsten</strong> (snelheid, podiums, vooruitgang) telt de vlucht mee.
        </p>
        <h3>Je duif verandert van league</h3>
        <p>
          De score van een duif beweegt: trainen, de coach en vluchten tillen haar op, ouderdom laat haar zakken. Komt
          ze tijdens een seizoen in een andere league terecht, dan blijven de punten die ze in haar oude league
          verdiende daar gewoon staan en begint ze in haar nieuwe league opnieuw. Ze kan dus in twee standen tegelijk
          verschijnen.
        </p>
        <p><strong>Strategie:</strong> een duif net onder een grens (★69,8) is in haar league een van de sterksten;
          een duif net erboven is in de volgende league een van de zwaksten. Een paar punten training kunnen je dus een
          league hoger duwen — kijk eerst waar je duif het meest kan winnen. En omdat de stand een heel seizoen loopt,
          is <em>elke week meedoen</em> meer waard dan één keer schitteren.</p>
      </Section>

      <Section id="eigenschappen" icon="📋" title="Wat doet elke eigenschap tijdens een vlucht?">
        <p className="muted" style={{ marginTop: 0 }}>
          Elke eigenschap heeft één duidelijke rol. Ze doen niet allemaal hetzelfde, en ze
          werken niet allemaal op je snelheid.
        </p>
        <p>
          <strong>Elke eigenschap heeft haar eigen terrein.</strong> Snelheid telt op élke
          vlucht mee en weegt het zwaarst op de sprint. Conditie wordt belangrijker naarmate
          de rit langer duurt en neemt het over vanaf ongeveer 300 à 500 km. Oriëntatie doet
          op een regiovlucht bijna niets en beslist mee op de fond. Een hok dat alles op één
          eigenschap zet, komt dus een deel van de kalender tekort.
        </p>
        <p>
          <strong>Snelheid is het tempo dat ze vraagt, conditie of ze het volhoudt.</strong>{' '}
          Twee duiven met snelheid 90 halen allebei hetzelfde toptempo. Maar die met zwakke
          conditie haalt het enkel in <em>vlagen</em> — elke versnelling bouwt vermoeidheid op,
          en die trekt haar verderop weer naar beneden. Met sterke conditie zit ze het hele
          eind tegen haar plafond aan, en na een rustiger stuk kan ze ook sneller weer
          versnellen. Op een sprint van 150 km is er amper tijd om leeg te lopen (daar wint
          snelheid); vanaf de middenafstand begint dit te tellen, en op de fond beslist het
          de wedstrijd.
        </p>
        <MiniTable
          head={['Conditie', 'Tempo in het laatste derde van de rit — 300 km', '700 km']}
          rows={[
            ['40', '90 % van haar begintempo', '89 %'],
            ['55', '92 %', '88 %'],
            ['70', '93 %', '92 %'],
            ['85', '97 %', '95 %'],
            ['95', '100 %', '97 %'],
          ]}
        />
        <MiniTable
          head={['Eigenschap', 'Wat ze doet', 'Waar ze het zwaarst weegt']}
          rows={[
            ['⚡ Snelheid', 'Het tempo dat je duif vraagt. Telt overal mee.', 'Korte vluchten (sprint)'],
            ['💪 Conditie', 'Dat tempo kunnen vasthouden en er weer bovenop komen.', 'Vanaf ±300 km, en de fond'],
            ['🧭 Oriëntatie', 'De weg vinden. Bepaalt of je duif omvliegt of de weg helemaal kwijtraakt.', 'Lange vluchten en slecht weer'],
            ['❤️ Gezondheid', 'Samen met energie je vluchtvorm: de kans op blessure en ziekte. Heel lage gezondheid maakt een duif zelfs niet-vluchtklaar.', 'Overal'],
            ['🔋 Energie', 'De tank. Samen met gezondheid je vluchtvorm; bij een bijna lege tank valt een duif uit of erger.', 'Overal, zwaarder op lange vluchten'],
            ['🎓 Ervaring', 'Zuiniger vliegen en sneller herstellen. Maakt niet sneller.', 'Vooral op een lage tank'],
          ]}
        />
        <p style={{ marginTop: 12 }}>
          <strong>🎲 Vorm van de dag.</strong> Bij elke lossing krijgt je duif nog een dagvorm
          mee: meestal een kleine afwijking, af en toe een echt goede of mindere dag. Die
          uitschieters zijn onlangs een stuk kleiner gemaakt — een duidelijk betere duif won
          vroeger maar een derde van haar duels en werd te vaak laatste, wat trainen en
          coachen zinloos liet lijken. Kwaliteit weegt nu duidelijk zwaarder. Een verrassing
          blijft wél mogelijk: ook een topper staat nog geregeld buiten het podium.
        </p>
      </Section>

      <Section id="verdwalen" icon="🧭" title="Verdwalen: waar oriëntatie voor dient">
        <p className="muted" style={{ marginTop: 0 }}>
          Oriëntatie is je navigatie-eigenschap. Ze maakt je duif niet sneller — ze bepaalt
          of ze de lijn naar huis houdt, of kilometers omvliegt en soms de weg helemaal
          kwijtraakt. Het is een <strong>afstandseigenschap</strong>: op een regiovlucht doet
          ze bijna niets, op de fond beslist ze mee. De kans om van koers te raken is
          onlangs verlaagd, met de grootste knip op de korte vluchten.
        </p>
        <p>
          <strong>🕊️ Duiven vliegen als een zwerm.</strong> Bij de lossing vertrekt het hele
          veld als één wolk, en zolang je duif in die groep zit raakt ze <strong>zo goed als
          niet</strong> van koers — de duiven die de weg kennen slepen de rest mee, ook een
          duif met zwakke oriëntatie. Pas wanneer het veld uit elkaar getrokken wordt (de
          snellen lopen weg, de groep valt uiteen) vliegt ze op haar eigen kompas.
        </p>
        <ul>
          <li>In het <strong>eerste tiende</strong> van de route gebeurt er bijna niets — zo'n 3 % van alle afdwalingen.</li>
          <li>Op een <strong>korte vlucht</strong> blijft de groep langer samen, dus verdwaalt er minder.</li>
          <li>Op de <strong>fond</strong> breekt het veld snel open: daar doet oriëntatie het meeste werk.</li>
          <li>In een <strong>klein deelnemersveld</strong> is er nauwelijks een groep om je in te verstoppen.</li>
        </ul>
        <p>
          <strong>Het is geen enkele muntworp.</strong> Hoe verder de vlucht, hoe meer
          gelegenheid om af te dwalen — een slechte navigator kan op de fond twee of zelfs
          drie keer de lijn kwijtraken, een goede houdt hem. En het blijft een <strong>kans</strong>:
          ook een matige navigator vliegt geregeld een volledig schone race.
        </p>
        <p><strong>Kans dat ze minstens één keer van koers raakt</strong> (mooi weer, vol veld):</p>
        <MiniTable
          head={['Oriëntatie', '150 km', '300 km', '500 km', '700 km', '1000 km']}
          rows={[
            ['95', '3 %', '6 %', '10 %', '13 %', '18 %'],
            ['85', '11 %', '21 %', '33 %', '41 %', '53 %'],
            ['70', '26 %', '46 %', '64 %', '75 %', '87 %'],
            ['60', '36 %', '61 %', '78 %', '88 %', '95 %'],
            ['50', '47 %', '71 %', '88 %', '95 %', '98 %'],
            ['30', '64 %', '89 %', '96 %', '99 %', '100 %'],
          ]}
        />
        <p style={{ marginTop: 12 }}>
          <strong>Maar hoe vaak ze schoon thuiskomt, telt evenzeer</strong> — een enkele kleine
          omweg kost je zelden de wedstrijd, drie grote wel:
        </p>
        <MiniTable
          head={['Oriëntatie', 'Vlucht zonder één omweg (150 km)', '500 km', '1000 km']}
          rows={[
            ['95', '97 %', '91 %', '81 %'],
            ['85', '90 %', '67 %', '48 %'],
            ['70', '74 %', '35 %', '14 %'],
            ['60', '64 %', '21 %', '5 %'],
            ['30', '36 %', '4 %', '0 %'],
          ]}
        />
        <ul style={{ marginTop: 12 }}>
          <li>
            <strong>Slecht weer maakt het erger — maar niet voor iedereen.</strong> Het treft
            het hardst wie het toch al moeilijk had: een goede navigator merkt er weinig van,
            een slechte is bij ruw weer op de fond nagenoeg kansloos. De tabellen hierboven
            gaan uit van gemiddeld weer.
          </li>
          <li>
            <strong>De fond is milder geworden.</strong> Oriëntatie woog daar veel te zwaar:
            een duif met oriëntatie 60 vloog op ~730 km gemiddeld 102 km om en zat in bijna
            drie op vier vluchten tegen het maximum. Dat was geen risico meer maar een vaste
            tol. Nu is dat gemiddeld <strong>66 km</strong> en raakt ze het maximum nog in
            ongeveer één op vier vluchten.
          </li>
          <li>
            <strong>Op een korte vlucht blijft de omweg klein.</strong> Een omweg is een hap
            uit de route, en op een sprint beslist die hap meteen de wedstrijd. Op 120 km
            praat je over zo'n <strong>6 km</strong> (hoogstens 8); op de fond over tientallen
            kilometers. Je raakt op een sprint wél iets vaker van koers dan vroeger: de
            eigenschap telt nu over de hele kalender mee in plaats van bijna alleen op de fond.
          </li>
          <li>
            <strong>Er is een bovengrens.</strong> Op de fond vliegt een duif nooit meer dan
            <strong> ~15 % om</strong>, op een korte vlucht nooit meer dan ~7 %. 1000 km wordt
            in het allerergste geval 1150 km, geen odyssee.
          </li>
        </ul>
        <p style={{ marginTop: 12 }}>
          <strong>Wat het kost.</strong> Meestal vliegt ze een <strong>omweg</strong>: echte
          extra kilometers, dus echt tijdverlies, een val in de stand én extra energie. De
          omvang varieert sterk — soms een wiebeltje, soms een lus.
        </p>
        <MiniTable
          head={['Oriëntatie', 'Op 300 km', 'Op 700 km', 'Op 1000 km']}
          rows={[
            ['95', '~9 km', '~17 km', '~26 km'],
            ['85', '~13 km', '~26 km', '~42 km'],
            ['70', '~20 km', '~51 km', '~83 km'],
            ['60', '~23 km', '~71 km', '~114 km'],
            ['30', '~28 km', '~102 km', '~148 km'],
          ]}
        />
        <p className="faint" style={{ marginTop: 4 }}>
          (gemiddelde wanneer ze effectief van koers raakt — komt ze schoon thuis, dan is het nul)
        </p>
        <p style={{ marginTop: 12 }}>
          <strong>En soms raakt ze de weg helemaal kwijt.</strong> Dan komt ze die dag niet
          thuis. <strong>Je duif is nooit voorgoed weg</strong> — duiven vinden hun weg terug —
          maar het kan een paar dagen duren, en ze komt binnen met een <strong>lege tank, veel
          minder gezondheid</strong> en vaak een kwetsuur of ziekte. Zolang ze onderweg is kan
          ze niets: niet vliegen, trainen, koppelen of verkocht worden.
        </p>
        <MiniTable
          head={['Oriëntatie', 'Niet thuis (300 km)', '1000 km', '1000 km, slecht weer']}
          rows={[
            ['85 of hoger', 'praktisch nul', 'praktisch nul', 'praktisch nul'],
            ['70', '~0 %', '0,1 %', '0,1 %'],
            ['50', '0,9 %', '1,3 %', '1,7 %'],
            ['30', '4,6 %', '4,8 %', '6,1 %'],
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
          navigators. Op de fond is een goede navigator evenveel waard als een goede conditie.
        </p>
      </Section>

      <Section id="een-per-dag" icon="🗓️" title="Eén vlucht per duif per dag">
        <p className="muted" style={{ marginTop: 0 }}>
          Een duif vliegt <strong>hoogstens één vlucht per kalenderdag</strong>. Of die andere
          race nog moet beginnen, bezig is of allang uitgevlogen: staat ze die dag op een
          vlucht, dan is haar dag op.
        </p>
        <ul>
          <li>
            <strong>Alle vluchtsoorten tellen mee</strong> — een oefenvlucht, een
            league, de titanenwedstrijd en de estafettevlucht evengoed als een
            gewone wedstrijd.
          </li>
          <li>
            <strong>Twee vluchten op één dag pak je met twee duiven.</strong> Op de meeste
            dagen staan er twee races op de kalender; je kiest per duif welke van de twee.
          </li>
          <li>
            <strong>Uitschrijven geeft de dag terug.</strong> Haal je haar vóór de start van
            de vlucht (inschrijfgeld terug), dan is die dag weer vrij. Een race die ze
            <em> effectief gevlogen</em> heeft geef je niet meer terug — ook niet als ze
            uitviel of als je haar liet opgeven.
          </li>
          <li>
            <strong>Een afgelaste vlucht telt niet mee.</strong> Ging de race niet door bij
            gebrek aan melkers, dan mag je duif diezelfde dag gewoon nog een andere vliegen.
          </li>
          <li>
            <strong>De computermelkers volgen dezelfde regel</strong> — ook zij zetten geen
            duif twee keer op één dag in.
          </li>
        </ul>
        <p>
          Bij het inschrijven merk je het meteen: een duif die die dag al ergens staat,
          verschijnt <strong>niet</strong> in de keuzelijst, met eronder een regeltje dat
          zegt hoeveel duiven om die reden wegvallen.
        </p>
        <p className="muted" style={{ fontSize: '0.85rem' }}>
          Los daarvan blijft de vormaftrek voor <em>gisteren gevlogen</em> gewoon gelden (zie
          hieronder): twee dagen op rij vliegen mág, maar kost vorm.
        </p>
      </Section>

      <Section id="prijzengeld" icon="💶" title="Prijzengeld: wat een vlucht opbrengt">
        <p className="muted" style={{ marginTop: 0 }}>
          <strong>Elke duif die thuis raakt, verdient geld.</strong> De tabellen lopen door tot de laatste
          finisher: na de kopplaatsen volgen vlakke banden en daaronder een bodem die iedereen krijgt. Wie
          niet finisht — opgegeven, uitgevallen of de weg kwijt — krijgt niets.
        </p>
        <p className="notice" style={{ marginTop: 10 }}>
          ⚠️ <strong>Hoogstens 3 duiven per hok per vlucht.</strong> Enkel je <strong>3 best geplaatste</strong>{' '}
          duiven verdienen geld <em>én</em> seizoenspunten. Schrijf je er meer in, dan vliegen die gewoon mee,
          staan ze in de uitslag en gaan ze er nog steeds op vooruit — maar ze leveren niets op. In de uitslag
          staat er dan “buiten de 3” bij. Het prijzengeld van zo'n plaats <strong>vervalt</strong>: het schuift
          niet door naar de volgende duif.
        </p>
        <h3 style={{ marginBottom: 4 }}>Regionaal — 100–200 km · inschrijfgeld €10</h3>
        <MiniTable
          head={['Plaats', 'Prijzengeld']}
          rows={[['1', '€800'], ['2', '€600'], ['3', '€350'], ['4', '€220'], ['5', '€140'], ['6', '€110'], ['7', '€100'], ['8', '€90'], ['9 – 11', '€70'], ['12 – 15', '€60'], ['16 en verder', '€40']]}
        />
        <h3 style={{ marginBottom: 4, marginTop: 14 }}>Nationaal — 200–500 km · inschrijfgeld €20</h3>
        <MiniTable
          head={['Plaats', 'Prijzengeld']}
          rows={[['1', '€1.200'], ['2', '€800'], ['3', '€500'], ['4', '€320'], ['5', '€210'], ['6', '€180'], ['7', '€150'], ['8', '€140'], ['9', '€120'], ['10', '€100'], ['11 – 13', '€80'], ['14 – 17', '€70'], ['18 en verder', '€50']]}
        />
        <h3 style={{ marginBottom: 4, marginTop: 14 }}>Internationaal — 400–1200 km · inschrijfgeld €40</h3>
        <MiniTable
          head={['Plaats', 'Prijzengeld']}
          rows={[['1', '€2.200'], ['2', '€1.800'], ['3', '€1.000'], ['4', '€650'], ['5', '€420'], ['6', '€270'], ['7', '€240'], ['8', '€200'], ['9 – 11', '€140'], ['12 – 15', '€100'], ['16 en verder', '€75']]}
        />
        <h3 style={{ marginBottom: 4, marginTop: 14 }}>Leagues — sprint · 100–300 km · €20</h3>
        <MiniTable
          head={['Plaats', '★ t/m 60', '★ 61–70', '★ 71–80', '★ 81+']}
          rows={[
            ['1', '€500', '€700', '€850', '€1.000'], ['2', '€350', '€490', '€595', '€700'],
            ['3', '€250', '€350', '€425', '€500'], ['4', '€150', '€210', '€255', '€300'],
            ['5', '€125', '€175', '€215', '€250'], ['6', '€110', '€155', '€185', '€220'],
            ['7', '€90', '€125', '€155', '€180'], ['8', '€60', '€85', '€100', '€120'],
            ['9 – 11', '€50', '€70', '€85', '€100'], ['12 – 15', '€40', '€55', '€70', '€80'],
            ['16 en verder', '€30', '€40', '€50', '€60'],
          ]}
        />
        <h3 style={{ marginBottom: 4, marginTop: 14 }}>Leagues — grote fond · 400–1000 km · €20</h3>
        <MiniTable
          head={['Plaats', '★ t/m 60', '★ 61–70', '★ 71–80', '★ 81+']}
          rows={[
            ['1', '€800', '€1.120', '€1.360', '€1.600'], ['2', '€700', '€980', '€1.190', '€1.400'],
            ['3', '€600', '€840', '€1.020', '€1.200'], ['4', '€425', '€595', '€725', '€850'],
            ['5', '€300', '€420', '€510', '€600'], ['6', '€200', '€280', '€340', '€400'],
            ['7', '€175', '€245', '€300', '€350'], ['8', '€150', '€210', '€255', '€300'],
            ['9 – 11', '€90', '€120', '€150', '€175'], ['12 – 15', '€65', '€90', '€105', '€125'],
            ['16 en verder', '€45', '€65', '€75', '€90'],
          ]}
        />
        <p className="faint" style={{ marginTop: 12 }}>
          De <strong>titanenwedstrijd</strong> (§ hierboven) houdt bewust drie plaatsen zonder bodem — daar mag je
          toch maar één duif inzetten. De <strong>estafette</strong> betaalt per ploeg, top 5.
        </p>
      </Section>

      <Section id="seizoensprijzen" icon="🏆" title="De prijsuitreiking op het einde van een seizoen">
        <p className="muted" style={{ marginTop: 0 }}>
          Een seizoen duurt 4 weken. Daarna volgt de <strong>prijsuitreiking</strong> en gaat de ranglijst terug op
          nul. Ook bots dingen mee en kunnen winnen.
        </p>
        <h3 style={{ marginBottom: 4 }}>Melkerranglijst — de Roekoe (op seizoenspunten)</h3>
        <MiniTable
          head={['Plaats', 'Prijs']}
          rows={[
            ['🥇 1e', 'de Gouden Roekoe · €2.000 + badge Seizoenskampioen'],
            ['🥈 2e', 'de Zilveren Roekoe · €1.700'],
            ['🥉 3e', 'de Bronzen Roekoe · €1.400'],
            ['💰 4e en verder', 'seizoenspremie: je seizoenspunten ÷ 3, in euro'],
          ]}
        />
        <p className="faint" style={{ marginTop: 8 }}>
          De seizoenspremie krijgt <strong>elke melker buiten de top 3</strong> die punten haalde, afgerond naar
          beneden: 1.200 punten → €400, 300 punten → €100. Zo loont elke vlucht, ook als je niet om de beker meestrijdt.
        </p>
        <h3 style={{ marginBottom: 4, marginTop: 14 }}>Duivenranglijsten — de Vleugel</h3>
        <MiniTable
          head={['Plaats', 'Prijs (per ranglijst)']}
          rows={[['🥇 1e', 'de Gouden Vleugel · €1.000'], ['🥈 2e', 'de Zilveren Vleugel · €750'], ['🥉 3e', 'de Bronzen Vleugel · €500']]}
        />
        <p className="faint" style={{ marginTop: 8 }}>
          Drie ranglijsten: snelste duif, meeste podiums en meeste vooruitgang. Eén duif kan meerdere Vleugels winnen;
          het geld gaat naar haar eigenaar. De <strong>leagues</strong> reiken op hetzelfde moment hun eigen prijzen uit
          (<a href="#leagues">zie Leagues</a>).
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
          Koppelen kost <strong>€750</strong> en <strong>−15 energie per ouder</strong>, meteen afgerekend bij het
          koppelen. Beide ouders hebben minstens <strong>20 energie</strong> nodig, mogen niet ziek of gekwetst zijn,
          niet in de ziekenboeg zitten, niet ingeschreven staan voor een vlucht en niet nog <strong>uitrusten van een
          vorig nest</strong> (zie hieronder). Een broedende duif <strong>kan niet vliegen</strong> — stop het koppel
          als je haar terug wil inzetten (het vervalt dan zonder jongen, en zonder terugbetaling).
        </p>
        <p style={{ marginTop: 12 }}>
          <strong>Een koppel is voor één nest.</strong> Zodra de jongen er zijn, gaat het koppel uiteen en staan beide
          duiven weer los in je hok. Daarna <strong>rusten ze allebei 21 dagen</strong> voor ze opnieuw kunnen
          koppelen — ongeveer <strong>vier nesten per duivenjaar</strong>, net als bij echte duiven.
        </p>
        <ul>
          <li>De rust hangt aan de <strong>duif</strong>, niet aan het koppel: een andere partner kiezen omzeilt ze niet.</li>
          <li>Ze telt vanaf het moment dat de jongen <strong>uitkwamen</strong>.</li>
          <li>
            Een <strong>mislukte worp legt geen rust op</strong> — er zijn geen jongen geweest, en je hebt de energie
            al betaald. Je mag meteen opnieuw proberen.
          </li>
          <li>Rustende duiven staan niet in de keuzelijst bij <em>Kweek</em>; op de duifpagina zie je wanneer ze weer mag.</li>
        </ul>
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
        <p style={{ marginTop: 12 }}>
          <strong>Een lege worp geeft je de helft van het koppelgeld terug: €375.</strong> Er komt geen duif uit, en
          dat is een dobbelsteen die je niet zelf gooit. De <strong>andere helft blijft weg</strong>, samen met de
          15 energie per ouder — koppelen blijft een gok waar je iets voor op tafel legt. Je krijgt er een melding
          van, met het bedrag erbij.
        </p>
        <ul>
          <li>Alleen een <strong>lege worp</strong> betaalt terug. Komt er wél een jong (of een tweeling), dan heb je waar je voor betaalde.</li>
          <li>
            <strong>Zelf het koppel stoppen betaalt niets terug</strong>, en een koppel dat vervalt omdat een ouder
            verkocht is of gestorven, evenmin. Anders kon je koppelen, meteen stoppen, en zo je geld half terughalen
            wanneer je maar wil.
          </li>
          <li>Computermelkers vallen onder exact dezelfde regel.</li>
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
        <p style={{ marginTop: 12 }}>
          <strong>Dezelfde wachtkamer vangt een duif uit een gebeurtenis op.</strong> Kies je bij een dilemma de{' '}
          <em>erfenis</em> of de <em>verdwaalde duif</em> terwijl je hok vol zit, dan gaat ze niet verloren: ze wacht
          hier tot je plaats maakt. Zo'n duif is <strong>geen nest</strong> — ze telt niet mee voor je kweekbadges en
          ze houdt het koppelformulier <strong>niet</strong> tegen.
        </p>
      </Section>

      <Section id="samen-kweken" icon="🤝" title="Samen kweken met andermans duif">
        <p className="muted" style={{ marginTop: 0 }}>
          Kweek met de duif van een andere speler, zonder dat er een duif van eigenaar verandert. Eén van jullie krijgt
          de jongen, de andere een vergoeding die jullie samen afspreken. Je vindt het bij <em>Kweek → Samen kweken</em>.
        </p>
        <p><strong>Aanbieden.</strong> Zet een duif <em>beschikbaar</em> en kies meteen <strong>wat je wil: de jongen
          (dan betaal jij de vergoeding) of de vergoeding (dan gaan de jongen naar je partner)</strong>. Kies ook wat een
          partner minstens moet hebben: een <strong>algemene score (★)</strong>, <strong>energie</strong> en
          <strong> libido</strong>. Aanbieden is gratis. Een aangeboden duif is, net als een duif te koop, voor iedereen
          <strong> volledig te bekijken</strong>. Kies je later toch de andere kant (jongen ↔ vergoeding), dan vervallen de
          lopende voorstellen.</p>
        <p><strong>Gezond en thuis.</strong> Een duif om mee te kweken mag <strong>niet ziek of gekwetst</strong> zijn en
          <strong> niet ingeschreven</strong> staan voor een vlucht — niet om ze aan te bieden en niet om ze voor te stellen.
          Zolang ze aangeboden of voorgesteld is, kan je haar ook <strong>niet inschrijven</strong>: haal haar eerst uit het
          aanbod of trek het voorstel in.</p>
        <p><strong>Voorstellen en onderhandelen.</strong> Een andere speler stelt een eigen duif van het andere geslacht
          voor die aan je eisen voldoet, met een <strong>bedrag</strong>. Wie de jongen krijgt, ligt al vast — er wordt
          enkel over het bedrag onderhandeld. Wie aan de beurt is, gaat <strong>akkoord</strong>, doet een
          <strong> tegenvoorstel</strong> (een ander bedrag) of weigert. Zo gaat het heen en weer tot iemand akkoord
          gaat. Wie een voorstel doet, toont zijn duif volledig aan de andere speler.</p>
        <p><strong>De geschatte score van het jong</strong> zien beide spelers: wie een duif kiest om voor te stellen,
          en wie het voorstel krijgt. Het is het <strong>gemiddelde</strong> wat zo'n koppel oplevert: per vaardigheid
          het gemiddelde van de ouders ± toeval, begrensd door de <a href="#genen">gen-caps</a> die het jong erft (en
          lager bij <a href="#inteelt">inteelt</a>). Eén jong valt een paar punten hoger of lager uit. Eronder staat de
          <strong> geschatte marktwaarde</strong> van zo'n jong op de dag dat het uitkomt: de gewone waardering van het spel
          (<a href="#waarde">marktwaarde</a>) voor een pasgeboren duif met die score, die gen-caps en dat ras.</p>
        <ul>
          <li><strong>Akkoord = meteen broeden.</strong> Beide duiven moeten op dat moment kunnen broeden (zelfde regels
            als een eigen nest: oud genoeg, 20 energie, gezond, niet ingeschreven, niet aan het uitrusten) en de partner
            moet nog altijd aan de eisen voldoen — energie en libido bewegen elke dag.</li>
          <li><strong>Het kost elk €1.000</strong>, betaald bij het akkoord (een eigen nest kost €750, maar daarvoor moeten
            twee van je eigen duiven van de vluchten weg; hier maar één). Beide duiven verliezen 15 energie.</li>
          <li><strong>Het nest loopt als een gewoon nest:</strong> uitkomen kan even duren (geen vaste tijd, sneller bij
            hoog libido en veel energie), en <strong>jongen zijn niet gegarandeerd</strong> — een worp kan leeg uitkomen.</li>
          <li><strong>Alle jongen gaan naar dezelfde speler</strong> — een tweeling ook.</li>
          <li><strong>De vergoeding wordt pas betaald wanneer de jongen er zijn.</strong> Wie de jongen krijgt, moet ze
            bij het akkoord wel kunnen betalen.</li>
          <li><strong>Lege worp:</strong> geen vergoeding, en elk van jullie krijgt <strong>€500</strong> terug (de helft,
            net als bij een eigen nest).</li>
          <li><strong>Stoppen</strong> mag elk van beiden, zolang het nest loopt — dan krijgt niemand iets terug en wordt er
            geen vergoeding betaald. Hetzelfde als een ouder sterft.</li>
          <li><strong>Je eigen uitrusting telt niet mee:</strong> infrarood boven de nestbak doet niets voor dit nest.</li>
          <li>Daarna <strong>rusten beide duiven 21 dagen</strong>, net als na een eigen nest. <a href="#inteelt">Inteelt</a>{' '}
            geldt ook hier: zijn de twee familie, dan zie je dat bij de onderhandeling.</li>
          <li>Gaat een duif op een nest, wordt ze verkocht of niet meer aangeboden, dan vervallen de andere voorstellen
            waar ze in zat.</li>
        </ul>
        <p><strong>Enkel echte spelers.</strong> De computermelkers doen niet mee: ze bieden geen duif aan en stellen er
          geen voor.</p>
        <p><strong>Zit je hok vol</strong> wanneer de jongen uitkomen, dan gaan ze niet verloren: ze wachten bij <em>Kweek</em>
          tot je kiest welke je houdt, en je kan eerst plaats maken (zie <a href="#broeden">Kweken &amp; broeden</a>).</p>
      </Section>

      <Section id="inteelt" icon="🌳" title="Stamboom & inteelt">
        <p className="muted" style={{ marginTop: 0 }}>
          Op de pagina van elke duif kan je haar <strong>stamboom</strong> uitklappen: ouders, grootouders en
          overgrootouders. Per voorouder zie je of ze <strong>nog leeft</strong> en, zo ja, in <strong>welk hok</strong>{' '}
          ze zit — ook als dat het hok van een andere speler is. Klik erop om naar haar pagina te gaan.
        </p>
        <p>
          Een tak stopt bij een duif die er niet meer is. Dat is geen fout: met haar verdwijnt ook wie háár ouders
          waren. Haar naam blijft wel bewaard, dus je ziet nog wél dat ze bestaan heeft.
        </p>

        <p style={{ marginTop: 14 }}>
          <strong>Kweken met familie wordt afgeraden.</strong> Kies je twee verwanten, dan zegt het spel dat vóór je
          koppelt. Je mag doorgaan — maar het jong betaalt de rekening, en die blijft.
        </p>
        <ul>
          <li>
            <strong>Lagere genetische plafonds.</strong> De <a href="#genen">gen-caps</a> van het jong gaan omlaag,
            en dáár traint of coacht ze zich nooit meer uit. Hoe nauwer de verwantschap, hoe harder de klap.
          </li>
          <li>
            <strong>Grote kans op een afwijking.</strong> Drie vleugels, twee koppen, geen staart, of een duif die
            consequent ondersteboven vliegt. Je ziet het meteen aan haar prentje. Zo'n duif vliegt ook een tikje
            trager.
          </li>
        </ul>
        <MiniTable
          head={['Verwantschap', 'Plafonds omlaag', 'Kans op een afwijking']}
          rows={[
            ['Ouder, kind of grootouder', '−22', '85 %'],
            ['Volle broer en zus', '−18', '75 %'],
            ['Halfbroer en halfzus', '−11', '45 %'],
            ['Verder familie', '−5', '15 %'],
          ]}
        />
        <p className="muted" style={{ fontSize: '0.9rem' }}>
          Verwantschap wordt tot <strong>drie generaties</strong> terug bekeken, en enkel via voorouders die nog
          leven — is de gemeenschappelijke voorouder al dood, dan ziet niemand het verband nog. Ook de
          computermelkers (§bots) kweken nooit met familie.
        </p>

        <p style={{ marginTop: 14 }}>
          <strong>Een duif kan pas kweken vanaf 8 weken</strong> — dezelfde leeftijd waarop ze aan haar eerste
          vlucht mag beginnen.
        </p>
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
          <strong>Besmetting gaat per ziekte.</strong> Een zieke hokgenoot geeft <em>haar eigen</em> ziekte door, en de
          ene ziekte slaat veel makkelijker over dan de andere. Kans per week dat een hokgenoot het oploopt, per zieke
          duif buiten de ziekenboeg, bij een vluchtvorm van 75 en van 45:
        </p>
        <MiniTable
          head={['Ziekte', 'Ernst', 'Besmettelijk', 'Vorm 75', 'Vorm 45']}
          rows={[
            ['Paramyxovirose', 'ernstig', '×1,5', '9,9%', '18,5%'],
            ['Ornithose', 'matig', '×1,3', '8,3%', '15,7%'],
            ['Het Geel', 'licht', '×1,2', '7,5%', '14,3%'],
            ['Coccidiose', 'matig', '×1', '6,1%', '11,6%'],
            ['Duivenpokken', 'matig', '×0,7', '4,1%', '7,9%'],
            ['Salmonellose', 'ernstig', '×0,6', '3,5%', '6,7%'],
          ]}
        />
        <p style={{ marginTop: 12 }}>
          <strong>Hoe erg een spontane ziekte is, hangt óók van de gezondheid af.</strong> Een duif in goede doen sleept
          meestal iets lichts op; een verzwakte duif is degene die iets zwaars oploopt. Bij besmetting krijgt ze gewoon
          de ziekte van de zieke hokgenoot — ook een fitte duif kan zo paramyxo oplopen.
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

      <Section id="kenmerken" icon="✨" title="Kenmerken">
        <p className="muted" style={{ marginTop: 0 }}>
          Sinds seizoen 3 heeft ongeveer <strong>één duif op drie</strong> een <strong>kenmerk</strong>: een eigenschap
          voor het leven, zichtbaar voor iedereen (op de duifkaart, de markt, de veiling en de stamboom). Een kenmerk is
          <strong> altijd een voordeel</strong> — nooit een nadeel.
        </p>
        <ul>
          <li><strong>Snelheidskenmerken</strong> geven <strong>+5 % snelheid</strong>, maar enkel in hun eigen situatie
            (weer, temperatuur, afstand, licht/donker of gezelschap).</li>
          <li><strong>Passieve kenmerken</strong> werken altijd: minder verdwalen, minder energie of minder ziek.</li>
          <li>Van alle duiven met een kenmerk heeft ≈ 80 % een <strong>gewoon</strong> en ≈ 20 % een
            <strong> zeldzaam</strong> kenmerk. Een kenmerk maakt een duif ook wat meer waard (gewoon +5 %, zeldzaam +12 %).</li>
        </ul>
        <MiniTable
          head={['Kenmerk', 'Zeldzaamheid', 'Wanneer', 'Effect']}
          rows={[
            ['🌬️ Snelle flapper', 'gewoon', 'bij rugwind', '+5 % snelheid'],
            ['🪨 Stormbreker', 'gewoon', 'bij tegenwind', '+5 % snelheid'],
            ['🌧️ Regenvogel', 'gewoon', 'bij regen', '+5 % snelheid'],
            ['☀️ Mooiweervlieger', 'gewoon', 'bij kalm, droog weer', '+5 % snelheid'],
            ['🌙 Nachtvlieger', 'gewoon', 'zolang het donker is', '+5 % snelheid'],
            ['⚡ Sprinter', 'gewoon', 'vluchten tot 200 km', '+5 % snelheid'],
            ['🏔️ Fondvogel', 'gewoon', 'vluchten vanaf 600 km', '+5 % snelheid'],
            ['🐦 Sociale duif', 'gewoon', 'min. 2 andere duiven binnen 10 km', '+5 % snelheid'],
            ['🦅 Eenzaat', 'gewoon', 'geen enkele duif binnen 10 km', '+5 % snelheid'],
            ['❄️ Koudevlieger', 'zeldzaam', 'onder 10 °C', '+5 % snelheid'],
            ['🔥 Zomervogel', 'zeldzaam', 'vanaf 10 °C', '+5 % snelheid'],
            ['🌞 Dagvlieger', 'zeldzaam', 'zolang het licht is', '+5 % snelheid'],
            ['🧭 Thuisvinder', 'zeldzaam', 'altijd', '25 % minder kans om te verdwalen'],
            ['🔋 Zuinige vlieger', 'zeldzaam', 'altijd', '8 % minder energie per vlucht'],
            ['🛡️ IJzeren gestel', 'zeldzaam', 'altijd', '30 % minder kans om ziek te worden'],
          ]}
        />
        <p style={{ marginTop: 12 }}><strong>Weer en temperatuur.</strong> Het weerbericht van een vlucht vermeldt nu ook
          de temperatuur. Rugwind of tegenwind telt vanaf ongeveer 6 km/u langs de route; “kalm, droog” betekent geen
          regen en minder wind dan dat. Die kenmerken gelden dan voor de <strong>hele vlucht</strong>.</p>
        <p><strong>Licht en donker.</strong> Nachtvlieger en Dagvlieger kijken naar de échte zon: zonsopgang en
          -ondergang op de plek waar de duif op dat moment vliegt. Vertrekt een vlucht bij daglicht en valt de avond
          halverwege, dan krijgt een Nachtvlieger haar bonus <strong>enkel op het donkere stuk</strong>. Op de
          vluchtkaart staan zonsopgang 🌅 en zonsondergang 🌇 van die dag, zodat je kan inschatten wie in het donker
          thuiskomt.</p>
        <p><strong>Gezelschap.</strong> Sociale duif en Eenzaat kijken om de paar minuten hoeveel duiven er binnen
          10 km vliegen — je eigen duiven tellen mee, duiven die al thuis zijn niet. De bonus telt enkel voor de stukken
          waar dat klopt.</p>
        <p><strong>Tijdens de vlucht</strong> zie je op het live bord een ✨ bij de duif zolang haar kenmerk werkt, en in
          de uitslag staat een ✨ achter de duiven bij wie het meetelde (bij licht/donker en gezelschap met het deel
          van de vlucht, bv. “🌙 38 %”).</p>
        <p><strong>Overerving.</strong> Een jong erft het kenmerk van elke ouder met ≈ 35 % kans (eerst van de vader,
          dan van de moeder). Hebben <strong>beide ouders hetzelfde kenmerk</strong>, dan is dat ≈ 60 %. Erft het jong
          niets, dan krijgt het de gewone kans op een eigen kenmerk. Zo kan je een lijn op een kenmerk kweken.</p>
        <p><strong>Strategie:</strong> +5 % is een klein maar echt voordeel — in haar eigen situatie wint een duif met
          kenmerk zo’n drie duels op vier van een identieke duif zonder. Kijk bij het inschrijven naar het weer en de
          afstand: een Sprinter op een korte vlucht is “in haar element”.</p>
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

      <Section id="tribune" icon="💬" title="De tribune: reageren tijdens een vlucht">
        <p className="muted" style={{ marginTop: 0 }}>
          Onder elke <strong>live vlucht</strong> staat een tribune: een chatbox waarin je met kant-en-klare
          kreten kan reageren. Je kiest uit een lijst — zelf typen kan niet, en dat is bewust: zo blijft het
          kort, en zo weet iedereen dat wat er staat ook echt uit het spel komt.
        </p>

        <p><strong>Twee soorten boodschappen:</strong></p>
        <ul>
          <li><strong>Naar de vlucht.</strong> Iedereen die meekijkt ziet ze. “Allez hop!”, “Schanduleus!”</li>
          <li>
            <strong>Naar een speler.</strong> Ook openbaar — iedereen leest ze — maar de speler die je noemt
            krijgt er bovendien een melding van. Je kiest eerst de tekst, dan pas naar wie.
          </li>
        </ul>

        <p><strong>Hoe je er meer krijgt.</strong> Je level bepaalt wat je mág zeggen, munten of je ervoor wil
        betalen. Er zijn vier manieren om aan een reactie te komen:</p>
        <MiniTable
          head={['Route', 'Wat het is']}
          rows={[
            ['Startgeschenk', 'twee scherpere reacties zitten vanaf dag één in je hok — gratis'],
            ['Mijlpaal', 'bij level 3, 5, 7 en 9 krijg je er telkens één cadeau, zonder munten'],
            ['Badge', 'sommige hangen aan een badge: je verdient de grap door het moment zelf te beleven'],
            ['Winkel', 'de rest: level gehaald én betaald (100, 250 of 500 munten)'],
          ]}
        />

        <ul style={{ marginTop: 12 }}>
          <li>
            <strong>Geen enkele categorie staat helemaal dicht.</strong> Ook een verse speler heeft al iets uit
            de zwaarste rubrieken staan — je ziet dus altijd wat er te halen valt.
          </li>
          <li>
            <strong>Recent staat bovenaan.</strong> De laatste zes die je gebruikte staan altijd op dezelfde
            plek, zodat je niet elke keer moet zoeken.
          </li>
          <li>
            <strong>Er zit een rem op.</strong> 20 seconden tussen twee kreten, dezelfde kreet vouwt samen tot
            ×2, ×3 … en niemand mag meer dan een deel van de tribune vullen.
          </li>
          <li>
            <strong>De tribune verdwijnt met de vlucht.</strong> Zolang de uitslag zichtbaar is blijft hij
            staan; daarna wordt hij samen met de vlucht opgeruimd.
          </li>
        </ul>
      </Section>

      <Section id="lokaal" icon="🍻" title="Het Lokaal: praten met alle spelers">
        <p className="muted" style={{ marginTop: 0 }}>
          In het echte duivenmelken is <strong>het lokaal</strong> het café waar de bond samenkomt. In Roekoe is
          het een <strong>vrije chat met alle spelers</strong>: uitslagen bespreken, een duif aanprijzen die je
          verkoopt, of gewoon wat zeveren. Anders dan de tribune typ je hier zelf wat je wil.
        </p>
        <ul>
          <li>
            <strong>Schrijven.</strong> Typ onderaan je bericht en druk op <strong>Verstuur</strong> (op een
            computer kan het ook met <strong>Enter</strong>; <strong>Shift + Enter</strong> geeft een nieuwe regel).
            Een bericht mag tot 500 tekens lang zijn.
          </li>
          <li>
            <strong>GIFs.</strong> Tik op de knop <strong>GIF</strong> naast het tekstvak, zoek op een woord (of kies
            uit wat nu populair is) en tik op een GIF om ze meteen te versturen.
          </li>
          <li>
            <strong>Lezen.</strong> Je eigen berichten staan rechts, die van de anderen links met hun hoknaam erboven.
            Nieuwe berichten verschijnen vanzelf zolang de pagina open staat. Noemt iemand jouw hoknaam, dan krijgt
            dat bericht een oranje rand.
          </li>
          <li>
            <strong>Het bolletje.</strong> Staat er iets nieuws dat je nog niet las, dan krijgt de knop
            {' '}<strong>🍻 Het Lokaal</strong> een bolletje (op gsm ook de knop <strong>Meer</strong>).
          </li>
          <li>
            <strong>Weghalen.</strong> Tik op een eigen bericht om het weg te halen. De beheerder kan elk bericht
            weghalen — hou het dus gezellig.
          </li>
          <li>
            <strong>Hoe lang blijft het staan?</strong> Berichten blijven 30 dagen bewaard; daarna worden ze
            opgeruimd. Met <strong>⬆ Oudere berichten</strong> bovenaan lees je verder terug.
          </li>
        </ul>
      </Section>

      <Section id="stem" icon="🗳️" title="De Stem: jij kiest de volgende feature">
        <p className="muted" style={{ marginTop: 0 }}>
          Het spel blijft groeien, en <strong>elk seizoen komt er één nieuwe feature bij</strong>. Welke dat
          wordt, beslissen de spelers samen op de pagina <strong>🗳️ De Stem</strong>.
        </p>

        <p><strong>Drie dingen doe je er:</strong></p>
        <ul>
          <li>
            <strong>Stemmen.</strong> Klik op 👍 bij elk idee dat jij wil zien. Je mag er zoveel steunen als je
            wil — het is geen keuze tussen één van de vier — en je stem weer intrekken. Eén stem per speler per
            idee, en bots stemmen niet mee. <strong>Je stem is niet anoniem</strong>: de beheerder ziet wie op
            wat stemde. Andere spelers zien enkel het aantal.
          </li>
          <li>
            <strong>Vragen stellen.</strong> Onder elk idee staat een draad voor vragen en opmerkingen. Daar
            wordt een idee scherper vóór het gebouwd wordt: “wat als iemand niet kan afbetalen?” is een betere
            bijdrage dan een stem.
          </li>
          <li>
            <strong>Zelf een idee indienen.</strong> Titel, korte uitleg, klaar. Maximaal drie per dag, en je
            eigen idee draagt automatisch je stem. <strong>Iedereen krijgt er een melding van</strong> zodra je
            het op het bord zet.
          </li>
        </ul>

        <p><strong>Wat het label bij een idee betekent:</strong></p>
        <MiniTable
          head={['Label', 'Wat het wil zeggen']}
          rows={[
            ['In stemming', 'kandidaat — hierop kan je stemmen'],
            ['Gepland', 'weerhouden, wordt gebouwd'],
            ['In het spel', 'zit er intussen in; stemmen kan niet meer'],
            ['Niet weerhouden', 'gaat er niet komen, met de reden in de draad'],
          ]}
        />

        <p className="muted" style={{ marginTop: 12 }}>
          Enkel de beheerder verzet die labels. Een ingediend idee wordt nooit herschreven of gewist — ook een
          afgewezen idee blijft staan, mét zijn stemmen en zijn draad, zodat je later kan zien waarom iets het
          niet werd.
        </p>
      </Section>

      <Section id="veilingen" icon="🔨" title="Veilingen: bieden, slotfase & anti-snipe">
        <p className="muted" style={{ marginTop: 0 }}>
          Elke <strong>zondag</strong> gaan er <strong>twee</strong> topduiven onder de hamer, elk met een gegarandeerde
          algemene score. Daarnaast duikt er af en toe een duif uit het <strong>opvangcentrum</strong> op (maar niet
          terwijl een zondagveiling loopt).
        </p>
        <MiniTable
          head={['Zondagduif', 'Algemene score', 'Loopt van', 'tot']}
          rows={[['Duif 1', '60 – 70', '10:00', '20:00'], ['Duif 2', '70 – 80', '11:00', '21:00']]}
        />
        <p className="notice" style={{ marginTop: 10 }}>
          ⚠️ <strong>Op beide bieden vraagt 2 vrije plaatsen.</strong> Heb je het hoogste bod op de ene zondagduif, dan
          kan je pas op de andere bieden als je <strong>2 vrije plaatsen</strong> in je hok hebt. Word je op de eerste
          overboden, dan volstaat weer 1 vrije plaats. Zo kunnen de sterkste hokken niet zomaar allebei de topduiven
          wegkapen.
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

      <Section id="schuld" icon="🔴" title="Rode cijfers & gedwongen veiling">
        <p className="muted" style={{ marginTop: 0 }}>
          Je vaste onkosten worden <strong>elke dag</strong> afgerekend, of je nu inlogt of niet.
          Je kassa kan dus vanzelf onder nul zakken — en dan komt er een traject op gang dat
          je zelf kan stoppen door te verkopen.
        </p>
        <MiniTable
          head={['Wanneer', 'Wat er gebeurt']}
          rows={[
            ['Meteen', 'Al je privécoaches worden ontslagen en je kan niets meer kopen'],
            ['Na 10 dagen', 'Je duif met het laagste talent gaat 24 u onder de hamer'],
            ['Elke 10 dagen daarna', 'De volgende duif volgt, tot je kassa weer klopt'],
          ]}
        />
        <p>
          <strong>Wat je niet meer kan.</strong> Duiven of voer kopen, trainen, koppelen, een
          rustkuur, hernoemen, uitbreiden, personeel bijnemen, een coach inhuren, wedden,
          bieden en inschrijven voor een vlucht.
        </p>
        <p>
          <strong>Wat je wél kan — en moet.</strong> Verkopen is je uitweg: een duif te koop
          zetten, voer terugverkopen (aan 80 %), een bod op je duif aanvaarden, personeel
          ontslaan. Dat blijft allemaal open.
        </p>
        <p>
          <strong>De gedwongen veiling.</strong> Je duif wordt <em>geveild</em>, niet zomaar
          verkocht: ze opent op haar marktwaarde en de club bepaalt wat ze opbrengt. De volledige
          opbrengst gaat naar jouw kassa. Komt er geen enkel bod, dan blijft ze gewoon in je hok
          en gaat ze de volgende ronde 25 % lager onder de hamer. Op je eigen veiling kan je niet
          meebieden.
        </p>
        <p className="faint" style={{ fontSize: '0.85rem' }}>
          <strong>Je laatste duif wordt nooit geveild.</strong> Een leeg hok verdient niets en
          kan zich nooit terugvechten — dat zou een zwaardere straf zijn dan de schuld zelf.
          Duiven die ingeschreven staan voor een vlucht, aan het koppelen zijn of de weg kwijt
          zijn, blijven eveneens buiten schot.
        </p>
      </Section>

      <Section id="hygiene" icon="🧹" title="Hokhygiëne, vers stro & de hokpoetser">
        <p className="muted" style={{ marginTop: 0 }}>
          Je hok heeft een <strong>hygiënemeter van 0 tot 100</strong>. Vers stro zet hem op 100. Je ziet en koopt het op de pagina{' '}
          <em>Inrichting</em>.
        </p>
        <ul>
          <li><strong>Boven 50 zakt de kans op ziekte</strong>, tot <strong>×0,8</strong> bij 100 (bij 75 is dat ×0,9). Op of onder 50 gebeurt er niets — zo was het altijd.</li>
          <li><strong>Vers stro:</strong> €18 per baal, één baal per 8 plaatsen (een hok van 12 = 2 balen = €36).</li>
          <li><strong>De meter zakt elke dagovergang</strong>: 8 punten in een vol hok, minder in een half leeg hok, 50 % sneller zolang er een zieke duif (ziekte, geen kwetsuur) tussen de anderen zit, en 25 % trager met dakventilatie.</li>
          <li><strong>Hokpoetser:</strong> per dag €10 tot 8 duiven, €15 tot 12, €20 tot 14, €30 tot 16, €45 tot 18 en €75 tot 20 duiven: hoe meer duiven, hoe duurder. Aannemen en ontslaan is gratis. Zakt de meter onder 70, dan strooit hij vers stro (aan de gewone prijs). Hij ontsmet ook: besmetting tussen duiven ×0,85.</li>
          <li><strong>Een bodem:</strong> hygiëne, een apart hok, de poetser en het kenmerk IJzeren gestel samen maken de kans op ziekte nooit kleiner dan <strong>×0,4</strong>. Vaccins tellen daar los bovenop.</li>
        </ul>
      </Section>

      <Section id="inrichting" icon="🛠️" title="Hokinrichting, vaccins & diensten">
        <p className="muted" style={{ marginTop: 0 }}>
          Alles hieronder koop je op de pagina <em>Inrichting</em> (vier blokken: plaatsen &amp; hokken, hygiëne, vaccins &amp; kuren, uitrusting) of op de pagina van een duif; het vakblad vind je op de <em>Markt</em>. <strong>Niets kopen = het spel zoals
          vroeger.</strong> Elk onderdeel geeft maar een <strong>klein</strong> voordeel; pas alles samen maakt het verschil. Inrichting
          koop je <strong>één keer</strong>: enkel de hokpoetser, het vakblad en een verzekering kosten per dag (zie je <em>Dagbalans</em>).
          De pagina <em>Inrichting</em> zegt het kort; hier staan de <strong>exacte cijfers</strong> (niveau 1). Stro en de hokpoetser:
          zie <a href="#hygiene">Hokhygiëne</a>.
        </p>
        <MiniTable
          head={['Wat', 'Prijs', 'Voordeel']}
          rows={[
            ['Apart hok', '€800, elk volgend +€400', 'voor de duif die erin zit: +60 % energieherstel, +40 % gezondheidsherstel, 50 % minder kans op ziekte'],
            ['Ziekenboegbed', '€800 → €2.400', 'meer zieke duiven tegelijk in de ziekenboeg (zie Ziekenboeg)'],
            ['Buitenren', '€2.500', '+6 i.p.v. +4 energie op elke 3e rustdag · libido +3 · zonder afweer ~1× per 40 dagen een sperwer: wie thuis rust −6 energie'],
            ['Roofvogelafweer', '€900', 'net + lokuil (vraagt een ren): geen sperwer in de ren, en de gebeurtenis "Sperwer in de buurt" is ongevaarlijk'],
            ['Dakventilatie', '€1.200', '40 % minder kans op ornithose · de hygiëne zakt 25 % trager · +5 % gezondheidsherstel uit het voer'],
            ['Kunstlicht', '€700', 'libido +6 bij al je duiven: sneller een nest en meer broedsucces'],
            ['Infrarood nestbakken', '€1.600 voor 2, +€500 per bak', 'een nest komt 15 % sneller uit · +6 % kans op een tweeling · onder 10 °C +4 % slaagkans'],
            ['Betere reismanden', '€1.000', 'elke vlucht 3 % minder energieverlies en 5 % minder gezondheidsverlies'],
            ['Weerstation', '€1.500', 'het weer bij de lossing al 24 u vooraf, om de 6 u bijgewerkt (het weer kan nog afwijken)'],
            ['Vakblad', '€6/dag, opzegbaar', 'bandbreedte i.p.v. enkel ★ bij andermans duif (op haar pagina en bij een privébod) · marktrapport over 28 dagen (onderaan de Markt) · elke maandag Het Duivenblad (in je meldingen)'],
          ]}
        />

        <h3 style={{ marginBottom: 4 }}>Niveaus</h3>
        <p className="muted" style={{ marginTop: 0 }}>
          Ventilatie, buitenren, kunstlicht, infrarood en reismanden kan je, eens gekocht, <strong>tot niveau 4</strong>{' '}
          opwaarderen. Elk niveau kost <strong>3× zoveel</strong> als het vorige en werkt sterker: niveau 2 ×1,5, niveau 3 ×1,8,
          niveau 4 <strong>dubbel</strong> zo sterk als niveau 1. Steeds duurder voor steeds minder: iets voor wie geld over heeft,
          nooit een must. Roofvogelafweer, weerstation en vakblad hebben geen niveaus.
        </p>
        <ul>
          <li><strong>Formule prijs:</strong> prijs niveau <em>n</em> = prijs niveau 1 × 3<sup><em>n</em>−1</sup> (×1, ×3, ×9, ×27).</li>
          <li><strong>Formule effect:</strong> elk getal uit de tabel hierboven × 1 · 1,5 · 1,8 · 2 voor niveau 1 · 2 · 3 · 4.
            Voorbeeld: ventilatie niveau 3 = 40 % × 1,8 = 72 % minder kans op ornithose.</li>
          <li>Op de pagina <em>Inrichting</em> zie je bij elk niveau het <strong>hoofdeffect, nu en na de stap</strong>
            (bv. "ornithose −60 % → −72 %"); de andere effecten van dat onderdeel groeien evenveel mee. Tik op de
            <strong>ⓘ</strong> naast een onderdeel voor al zijn effecten, nu en na aankoop.</li>
        </ul>
        <MiniTable
          head={['Onderdeel', 'Niveau 1', 'Niveau 2', 'Niveau 3', 'Niveau 4', 'Op niveau 4']}
          rows={[
            ['Dakventilatie', '€1.200', '€3.600', '€10.800', '€32.400', '80 % minder ornithose · hygiëne zakt 50 % trager · +10 % herstel'],
            ['Buitenren', '€2.500', '€7.500', '€22.500', '€67.500', '+8 i.p.v. +4 energie op elke 3e rustdag · libido +6'],
            ['Kunstlicht', '€700', '€2.100', '€6.300', '€18.900', 'libido +12'],
            ['Infrarood nestbakken', '€1.600', '€4.800', '€14.400', '€43.200', 'nest 30 % sneller uit · +12 % tweelingkans · onder 10 °C +8 % slaagkans'],
            ['Betere reismanden', '€1.000', '€3.000', '€9.000', '€27.000', 'elke vlucht 6 % minder energie- en 10 % minder gezondheidsverlies'],
          ]}
        />

        <h3 style={{ marginBottom: 4 }}>Vaccins &amp; kuren</h3>
        <p className="muted" style={{ marginTop: 0 }}>
          Elk middel werkt tegen één ziekte: wordt een beschermde duif ziek met precies die ziekte, dan weert ze het af
          met de kans uit de tabel. Een vaccin houdt haar 2 dagen aan de grond; een kuur is kort, voor als er iets
          rondgaat. Per duif op haar pagina, of het hele hok tegelijk op de pagina <em>Inrichting</em>: dat slaat duiven
          over die nog meer dan een kwart van hun bescherming hebben.
        </p>
        <MiniTable
          head={['Middel', 'Ziekte', 'Prijs', 'Werkt', 'Weert af', 'Bijwerking']}
          rows={[
            ['PMV-vaccin', 'Paramyxovirose', '€10', '91 dagen', '80 %', '2 dagen niet vliegen'],
            ['Pokkenvaccin', 'Duivenpokken', '€8', '91 dagen', '80 %', '2 dagen niet vliegen'],
            ['Salmonellavaccin', 'Salmonellose', '€6', '45 dagen', '60 %', '2 dagen niet vliegen'],
            ['Geelkuur', 'Het Geel', '€5', '7 dagen', '75 %', '—'],
            ['Coccidiosekuur', 'Coccidiose', '€5', '10 dagen', '75 %', '—'],
            ['Ademhalingskuur', 'Ornithose', '€5', '7 dagen', '60 %', 'libido −10'],
          ]}
        />
        <p className="muted">
          <strong>Loont het?</strong> Hoe meer je duif waard is, hoe meer een middel haar bespaart: wat een ziekte echt
          kost zijn de dagen in de ziekenboeg met dokter en medicatievoer, de vluchten die ze mist (een zieke duif krijgt
          geen of maar halve energie binnen) en de kans dat ze sterft. Je betaalt ook als ze die ziekte anders nooit had
          gekregen — het is een investering. Een <strong>vaccin</strong> loont gemiddeld vanaf een duif met een
          marktwaarde van zo'n €6.400 (PMV), €8.600 (pokken) of €11.400 (salmonella); een topduif van €37.000 haalt er
          2 à 4 keer haar geld uit, en een duif die na elke vlucht diep zakt nog meer. Een <strong>kuur</strong> is kort
          en werkt tegen één ziekte: gemiddeld haal je er minder uit dan ze kost. Ze loont wél als die ziekte in je hok
          rondgaat en je de zieke duif niet kan afzonderen (ziekenboeg vol): een zieke hokgenoot geeft haar eigen ziekte
          door (zie <a href="#ziekte">Kans op ziekte</a>).
        </p>

        <h3 style={{ marginBottom: 4 }}>Verzekering</h3>
        <ul>
          <li>Per duif. Sterft ze, dan krijg je <strong>60 % van haar marktwaarde op het moment dat je afsloot</strong>.</li>
          <li>Premie per dag = 1,3 × uitkering × de kans dat ze die dag sterft: spotgoedkoop voor een jonge duif, duur voor een oude. Gemiddeld betaal je 30 % meer dan je terugkrijgt — je koopt rust, geen winst.</li>
          <li><strong>Gedekt:</strong> ziekte, ouderdom, de sperwer. <strong>Niet gedekt:</strong> honger, vertrekken met minder dan 5 energie, een ziekte die nooit in de ziekenboeg lag, vrijlaten of verkopen, en de eerste 7 dagen.</li>
          <li>Verkoop je haar, dan vervalt de verzekering.</li>
        </ul>

        <p className="faint" style={{ fontSize: '0.85rem' }}>Bots kopen vers stro en dakventilatie, verder niets.</p>
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
          <li>In het blok <em>Plaatsen &amp; hokken</em> op de pagina <em>Inrichting</em> zie je wat je volgende duif kost <strong>vóór</strong> je een uitbreiding koopt.</li>
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
        <p>
          Onder de waarde zie je op <strong>Mijn hok</strong> ook wat een duif al <strong>opgebracht</strong> heeft: al
          het prijzengeld dat ze voor jou won, over al haar vluchten samen. Koop je een duif, dan begint die teller bij
          jou opnieuw op nul.
        </p>

        <ul>
          <li>
            <strong>Vergelijkbare duiven bepalen de prijs.</strong> Ging er een duif van talent 70 weg
            voor €7.000, dan schuiven de duiven in die buurt mee omhoog: een paar punten talent verschil
            telt bijna volledig mee, wie twaalf punten lager zit merkt er weinig van.
          </li>
          <li>
            <strong>Een prijs blijft staan tot een nieuwere verkoop iets anders zegt.</strong> Wordt er
            niets vergelijkbaars meer verkocht, dan zakt de waarde niet vanzelf terug. Komt er wel een
            nieuwe verkoop, dan weegt die zwaarder dan de oudere: zo volgen de prijzen de markt van week
            tot week. Een verkoop telt 60 dagen mee, de laatste twee weken steeds minder.
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
          je mag je duif voor elk bedrag te koop zetten <strong>vanaf 1/5 van haar waarde</strong> (een duif
          van €10.000 dus vanaf €2.000). Lager kan niet, ook niet als bod; steeg haar waarde intussen, dan
          geldt 1/5 van de nieuwe waarde. Ze bepaalt wel het <strong>startbod van de
          veilingen</strong> (30 % van de waarde, zodat er nog te bieden valt) en wat de gladde koopman
          in een dilemma voor je pronkstuk neerlegt.
        </p>
        <p className="faint" style={{ fontSize: '0.85rem' }}>
          Wil je de prijzen zien bewegen? Kijk naar de <strong>verkoopgeschiedenis</strong> op de markt:
          dat is letterlijk de data waarop de schattingen draaien.
        </p>
        <h3 style={{ marginBottom: 4 }}>📌 Zoekertje naar boven</h3>
        <p className="muted" style={{ marginTop: 0 }}>
          Staat je duif te koop, dan kan je je zoekertje voor <strong>€50</strong> bovenaan de markt zetten. Het blijft
          daar <strong>12 uur</strong> — tot iemand anders zijn zoekertje naar boven haalt: er is maar één plek
          bovenaan, en de laatste die betaalt krijgt ze. Het jouwe zakt dan terug naar zijn gewone plaats (de rest
          staat op prijs, goedkoopste eerst). Haal je je duif uit de verkoop of wordt ze verkocht, dan is de boost
          weg; je prijs aanpassen mag zonder ze te verliezen.
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
            <strong> niets</strong> voor terug. De rest van je hok blijft ongemoeid, maar een andere speler met een{' '}
            <strong>duivenlokker</strong> kan haar opvangen (<a href="#duivenlokker">hoe dat werkt</a>).
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
            ['🕊️ Vrijlaten', '€0', 'geen — maar ze kan bij een concurrent met een duivenlokker landen'],
            ['🍲 Duivenrestaurant', '€50 (vast)', 'elke andere duif −1 tot −5 energie'],
          ]}
        />
        <p style={{ marginTop: 12 }}>
          <strong>Strategie:</strong> vrijlaten is het nettste als je gewoon plaats wil maken — tenzij je niet wil dat
          een concurrent je duif krijgt. Verkopen aan het restaurant geeft snel wat geld voor een duif die toch niets
          meer opbrengt, en daar komt ze zeker nooit meer terug; reken wel de energie-dip van je hele hok mee — doe het
          niet vlak voor een belangrijke vlucht.
        </p>
      </Section>

      <Section id="duivenlokker" icon="🧲" title="De duivenlokker: vrijgelate duiven zoeken een nieuw nest">
        <p className="muted" style={{ marginTop: 0 }}>
          Een duif die een speler <strong>vrijlaat</strong>, vliegt soms naar het hok van een <strong>andere
          speler</strong> — als die een duivenlokker heeft. Je koopt hem bij <em>Inrichting → Uitrusting</em> en
          waardeert hem op tot niveau 5. Hij kost niets per dag en je kan hem niet terugverkopen.
        </p>
        <MiniTable
          head={['Niveau', 'Prijs', 'Samen betaald', 'Kans als enige lokker', 'Naast één lokker van hetzelfde niveau']}
          rows={[
            ['1', '€500', '€500', '10 %', '9,1 %'],
            ['2', '€750', '€1.250', '13,5 %', '11,9 %'],
            ['3', '€1.500', '€2.750', '17,4 %', '14,8 %'],
            ['4', '€3.000', '€5.750', '21,7 %', '17,9 %'],
            ['5', '€5.000', '€10.750', '26,2 %', '20,8 %'],
          ]}
        />
        <h3 style={{ marginTop: 14 }}>Hoe de kans werkt</h3>
        <p>
          Elke lokker trekt aan de vrijgelaten duif, en de vrije lucht trekt ook. Een lokker trekt met{' '}
          <strong>10 / 14 / 19 / 25 / 32</strong> (niveau 1 tot 5), de vrije lucht met <strong>90</strong>. Je kans is
          jouw trekkracht gedeeld door alles samen:
        </p>
        <p style={{ textAlign: 'center', fontWeight: 600 }}>kans = jouw lokker ÷ (90 + alle lokkers samen)</p>
        <ul>
          <li><strong>Niemand heeft een lokker</strong> — de duif verdwijnt definitief uit het spel.</li>
          <li><strong>Enkel jij</strong> — enkel jij maakt kans, maar zonder garantie (zie de tabel).</li>
          <li><strong>Twee lokkers van hetzelfde niveau</strong> — allebei evenveel kans, en ze landt hoogstens bij één
            van beide. Ze kan ook nergens heen gaan.</li>
          <li><strong>Verschillende niveaus</strong> — iedereen maakt kans, maar het hoogste niveau altijd het meest.
            Voorbeeld: jij niveau 3, iemand anders niveau 1 → jij 16 %, de ander 8,4 %, verdwenen 75,6 %.</li>
          <li>Er is <strong>altijd</strong> een kans dat de duif nergens heen gaat: hoe meer lokkers, hoe kleiner, maar
            nooit nul. Jouw eigen lokker vangt nooit een duif die je zelf vrijlaat.</li>
        </ul>
        <h3>Gevangen: jij kiest</h3>
        <ul>
          <li>Vangt jouw lokker een duif, dan krijg je een bel en staat ze bij <strong>Kweek</strong>. Je ziet haar
            score, genen, leeftijd, ervaring en of ze ziek is, en je kiest of je haar <strong>houdt</strong>. Ze kost je
            niets; enkel het gewone onderhoud zodra ze in je hok zit.</li>
          <li>Zit je hok vol? Maak op hetzelfde scherm eerst plaats (vrijlaten of het restaurant) — of laat haar gaan.</li>
          <li>Laat je haar gaan, dan is ze <strong>voorgoed weg</strong>; ze gaat niet naar een andere lokker.</li>
          <li>Ze neemt haar vaardigheden, leeftijd, ervaring, vaccins, stamboom en historiek mee. Wat de vorige eigenaar
            regelde, blijft daar: coach, apart hok, ziekenboegbed, rustkuur, verzekering, zoekertje en kweekaanbod.</li>
        </ul>
        <h3>Wie zelf vrijlaat, hoort het</h3>
        <p>
          Laat je een duif vrij, dan zegt een bel meteen of een lokker haar ving (en bij wie) of dat ze verdwenen is.
          Werd ze gevangen, dan krijg je nog een bel zodra die speler beslist: gehouden, of toch losgelaten en voorgoed
          weg.
        </p>
        <h3>Wat er niet gelokt wordt</h3>
        <ul>
          <li>Een duif die je aan het <strong>restaurant</strong> verkoopt — daar wordt soep van gemaakt.</li>
          <li>Jongen uit een nest die je niet houdt, en duiven van de computermelkers (die kopen ook geen lokker).</li>
          <li>Een duif die op een <strong>veiling</strong> staat.</li>
        </ul>
      </Section>

      <Section id="tags" icon="🏷️" title="Tags op je duiven">
        <p className="muted" style={{ marginTop: 0 }}>
          Een geheugensteun voor jezelf: welke duif is je sprinter, welke je fondvogel, welke houd je voor de kweek?
          Geef haar een tag en je ziet het overal waar je een keuze maakt.
        </p>
        <ul>
          <li><strong>Zetten:</strong> op de pagina van een duif (tik op haar naam in <em>Mijn hok</em>) →{' '}
            <em>Tag toevoegen</em>. Tot <strong>3 tags</strong> per duif, elk hoogstens <strong>20 tekens</strong>;
            meerdere scheid je met een komma. Tags die je al op andere duiven gebruikt, staan eronder: één tik en ze
            staan erbij. Gratis, en je kan ze altijd aanpassen of wissen.</li>
          <li><strong>Zien:</strong> bij je duiven in <em>Mijn hok</em>, op de duifpagina, en bij het{' '}
            <strong>inschrijven</strong> op de Vluchten-pagina: in de keuzelijst staat achter elke duif die je kan
            inschrijven <em>🏷️ sprint</em> (of wat jij koos). Zo schrijf je de juiste duif in voor een korte regionale
            sprint of een lange internationale vlucht.</li>
          <li><strong>Privé:</strong> enkel jij ziet je tags. Andere spelers zien ze nooit, ook niet op de markt of bij
            een bod.</li>
          <li><strong>Bij verkoop weg:</strong> verandert een duif van eigenaar (verkoop, aanvaard bod, veiling,
            duivenlokker), dan verdwijnen haar tags.</li>
          <li>Een tag doet niets in het spel zelf: een duif met de tag <em>sprint</em> vliegt niet sneller. Wat een duif
            echt goed kan, lees je af aan haar eigenschappen en haar kenmerk (<a href="#eigenschappen">wat doet elke
            eigenschap?</a>).</li>
        </ul>
      </Section>

      <p className="muted" style={{ textAlign: 'center', fontSize: '0.9rem' }}>
        Onthoud: geluk zit overal in het spel. Deze cijfers helpen je slimmer kiezen — ze beslissen niets op voorhand.
      </p>
    </div>
  );
}
