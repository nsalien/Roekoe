/**
 * Wachtwoord vergeten (12 nov): de beheerder maakt een tijdelijk wachtwoord
 * (Beheer → Spelers), de speler kiest zelf een nieuw (Profiel → Wachtwoord).
 *
 * Gedekt, door de echte API op een SQLite-D1: een gewone speler kan geen lijst
 * opvragen en niets resetten; de beheerder ziet de echte spelers (geen bots) en
 * krijgt een tijdelijk wachtwoord in een leesbare vorm, dat meteen werkt terwijl
 * het oude niet meer werkt; een bot reset je niet; zelf wijzigen eist het juiste
 * huidige wachtwoord, minstens 4 tekens en iets nieuws; in de databank staat nooit
 * het wachtwoord zelf.
 *
 * Run: npx tsx tests/wachtwoord.test.mts
 */
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { onRequest } from '../functions/api/[[path]].ts';
import { D1Store, ensureSchema } from '../core/d1.js';
import { seedWorld } from '../core/game/engine.js';
import { advanceRealtime } from '../core/game/schedule.js';
import { temporaryPassword } from '../core/auth.js';

let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { c ? (pass++, console.log(`  ✓ ${m}`)) : (fail++, console.log(`  ✗ ${m}`)); };

function fakeD1(): any {
  const sql = new DatabaseSync(':memory:');
  const val = (v: unknown) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v);
  const prepare = (query: string) => {
    const bound: unknown[] = [];
    const api = {
      bind(...args: unknown[]) { bound.push(...args.map(val)); return api; },
      async first() { return sql.prepare(query).get(...(bound as any[])) ?? null; },
      async all() { return { results: sql.prepare(query).all(...(bound as any[])) }; },
      async run() { return sql.prepare(query).run(...(bound as any[])); },
    };
    return api;
  };
  return { prepare, async exec(query: string) { sql.exec(query); }, async batch(stmts: any[]) { for (const st of stmts) await st.run(); }, _raw: sql };
}

const d1 = fakeD1();
d1._raw.exec(readFileSync('./migrations/0001_init.sql', 'utf8'));
d1._raw.prepare('INSERT INTO world (id, current_week, season_year, seeded) VALUES (1, 1, 1, 0)').run();
for (let i = 0; i < 40 && !(await ensureSchema(d1)); i++);
{
  let s = await D1Store.load(d1);
  seedWorld(s);
  await s.persist();
  s = await D1Store.load(d1);
  advanceRealtime(s.data, Date.now(), new Map());
  s.data.world.lastAdvance = new Date().toISOString();
  await s.persist();
}
const SECRET = 'test-geheim';
async function call(path: string, method = 'GET', body?: unknown, token?: string) {
  const request = new Request(`http://t.local/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const res: Response = await (onRequest as any)({
    request, env: { DB: d1, JWT_SECRET: SECRET, INVITE_CODE: '' }, params: {}, data: {},
    waitUntil() {}, passThroughOnException() {}, next: () => Promise.reject(new Error('no next')),
  });
  return { status: res.status, json: await res.json() as any };
}
const login = (username: string, password: string) => call('/auth/login', 'POST', { username, password });

console.log('\n1. Twee spelers: de eerste is beheerder');
const baas = await call('/auth/register', 'POST', { username: 'baas', password: 'baas-geheim', loftName: 'Het Baashok' });
const jan = await call('/auth/register', 'POST', { username: 'jan', password: 'jan-geheim', loftName: 'Hok Jan' });
ok(baas.status === 200 && baas.json.user.isAdmin === true && jan.status === 200 && jan.json.user.isAdmin === false, 'baas is beheerder, jan niet');
const tBaas = baas.json.token, tJan = jan.json.token, janId = jan.json.user.id;

console.log('\n2. Een gewone speler kan niets');
ok((await call('/admin/users', 'GET', undefined, tJan)).status === 403, 'jan vraagt de spelerslijst: 403');
ok((await call(`/admin/users/${janId}/password`, 'POST', {}, tJan)).status === 403, 'jan reset een wachtwoord: 403');
ok((await call('/admin/users', 'GET')).status === 401, 'zonder in te loggen: 401');

console.log('\n3. De beheerder reset een wachtwoord');
const list = await call('/admin/users', 'GET', undefined, tBaas);
const names = (list.json.players ?? []).map((p: any) => p.username);
ok(list.status === 200 && names.includes('jan') && names.includes('baas') && names.length === 2, `de lijst: enkel de echte spelers (${names.join(', ')})`);
ok(list.json.players.find((p: any) => p.username === 'jan')?.loftName === 'Hok Jan', 'met hun hoknaam');
const reset = await call(`/admin/users/${janId}/password`, 'POST', {}, tBaas);
const temp = reset.json.password as string;
ok(reset.status === 200 && /^[a-hj-km-np-z2-9]{4}-[a-hj-km-np-z2-9]{4}$/.test(temp) && reset.json.username === 'jan', `een tijdelijk wachtwoord in een leesbare vorm (${temp})`);
ok((await login('jan', 'jan-geheim')).status === 401, 'het oude wachtwoord werkt niet meer');
const tempLogin = await login('jan', temp);
ok(tempLogin.status === 200, 'het tijdelijke wel');
const bot = d1._raw.prepare('SELECT id FROM users WHERE is_bot = 1 LIMIT 1').get() as any;
ok((await call(`/admin/users/${bot.id}/password`, 'POST', {}, tBaas)).status === 404, 'een bot reset je niet');
ok((await call('/admin/users/usr_bestaat_niet/password', 'POST', {}, tBaas)).status === 404, 'een onbekende speler: 404');

console.log('\n4. De speler kiest zelf een nieuw');
const tJan2 = tempLogin.json.token;
const wrong = await call('/auth/password', 'POST', { current: 'fout', next: 'nieuw-geheim' }, tJan2);
ok(wrong.status === 400 && /huidige/.test(wrong.json.error), `een verkeerd huidig wachtwoord: geweigerd ("${wrong.json.error}")`);
const short = await call('/auth/password', 'POST', { current: temp, next: 'abc' }, tJan2);
ok(short.status === 400 && /minstens 4/.test(short.json.error), 'te kort: geweigerd');
const same = await call('/auth/password', 'POST', { current: temp, next: temp }, tJan2);
ok(same.status === 400, 'hetzelfde wachtwoord: geweigerd');
const changed = await call('/auth/password', 'POST', { current: temp, next: 'nieuw-geheim' }, tJan2);
ok(changed.status === 200, 'gewijzigd');
ok((await login('jan', 'nieuw-geheim')).status === 200 && (await login('jan', temp)).status === 401, 'het nieuwe werkt, het tijdelijke niet meer');
ok((await call('/auth/password', 'POST', { current: 'x', next: 'yyyy' })).status === 401, 'zonder in te loggen: 401');

console.log('\n5. In de databank');
const rows = d1._raw.prepare("SELECT username, password_hash FROM users WHERE username IN ('jan', 'baas')").all() as any[];
ok(rows.every((r) => r.password_hash.startsWith('pbkdf2$') && !r.password_hash.includes('nieuw-geheim') && !r.password_hash.includes(temp)),
  'enkel een PBKDF2-hash, nooit het wachtwoord zelf');
ok((await login('baas', 'baas-geheim')).status === 200, 'het wachtwoord van de beheerder bleef ongemoeid');
const many = new Set(Array.from({ length: 200 }, () => temporaryPassword()));
ok(many.size === 200, 'tweehonderd tijdelijke wachtwoorden: allemaal verschillend');

console.log(`\n${pass} geslaagd, ${fail} mislukt`);
process.exit(fail > 0 ? 1 : 0);
