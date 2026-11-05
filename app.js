'use strict';

/* ---------- Config ---------- */
const API = 'https://site.api.espn.com/apis/site/v2/sports';
const API_V2 = 'https://site.api.espn.com/apis/v2/sports';
const ATHLETES = 'https://site.web.api.espn.com/apis/common/v3/sports';

const FOOTBALL_LEAGUES = [
  ['eng.1', 'Premier League'], ['esp.1', 'LaLiga'], ['ita.1', 'Serie A'],
  ['ger.1', 'Bundesliga'], ['fra.1', 'Ligue 1'], ['uefa.champions', 'Champions League'],
  ['uefa.europa', 'Europa League'], ['uefa.europa.conf', 'Conference League'],
  ['ind.1', 'Indian Super League'], ['afc.champions', 'AFC Champions League Elite'],
  ['eng.2', 'Championship'], ['eng.fa', 'FA Cup'], ['eng.league_cup', 'Carabao Cup'],
  ['esp.copa_del_rey', 'Copa del Rey'], ['usa.1', 'MLS'], ['ned.1', 'Eredivisie'],
  ['por.1', 'Primeira Liga'], ['tur.1', 'Turkish Super Lig'], ['bra.1', 'Brazilian Serie A'],
  ['arg.1', 'Argentine Primera'], ['fifa.world', 'FIFA World Cup'],
];
const DEFAULT_LEAGUES = ['eng.1', 'esp.1', 'ita.1', 'ger.1', 'fra.1', 'uefa.champions', 'ind.1'];
const CRICKET_NATIONS = [
  [6, 'India'], [2, 'Australia'], [1, 'England'], [7, 'Pakistan'], [3, 'South Africa'],
  [5, 'New Zealand'], [4, 'West Indies'], [8, 'Sri Lanka'], [25, 'Bangladesh'],
  [40, 'Afghanistan'], [9, 'Zimbabwe'], [29, 'Ireland'],
].map(([id, name]) => ({
  sport: 'cricket', id: String(id), name,
  logo: `https://a.espncdn.com/i/teamlogos/cricket/500/${id}.png`,
}));

const LIVE_POLL = 30000, MATCH_POLL = 20000, IDLE_POLL = 120000;
const SCAN_TTL = 3 * 3600 * 1000;

/* ---------- Saved choices ---------- */
const STORE_KEY = 'matchday.v1';
const state = loadState();
function loadState() {
  const base = { leagues: DEFAULT_LEAGUES.slice(), series: [], teams: [], sport: 'all', allCricket: false };
  try { return Object.assign(base, JSON.parse(localStorage.getItem(STORE_KEY)) || {}); } catch { return base; }
}
function save() { try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch { /* private mode */ } }
const teamKey = (t) => `${t.sport}:${t.id}`;
const isFollowed = (sport, id) => state.teams.some((t) => t.sport === sport && String(t.id) === String(id));
function toggleTeam(team) {
  const key = teamKey(team);
  if (state.teams.some((t) => teamKey(t) === key)) {
    state.teams = state.teams.filter((t) => teamKey(t) !== key);
  } else {
    state.teams.push(team);
    if (team.league && team.sport === 'soccer' && !state.leagues.includes(team.league)
      && FOOTBALL_LEAGUES.some(([slug]) => slug === team.league)) state.leagues.push(team.league);
  }
  save();
}

/* ---------- Helpers ---------- */
const $ = (id) => document.getElementById(id);
const view = $('view');
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ESC[c]);
const strip = (v) => {
  const el = document.createElement('template');
  el.innerHTML = String(v == null ? '' : v).replace(/<br\s*\/?>/gi, ' ');
  return (el.content.textContent || '').replace(/\s+/g, ' ').trim();
};
const pad = (n) => String(n).padStart(2, '0');
const dayKey = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const timeOf = (iso) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const dateOf = (iso) => new Date(iso).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
const initials = (name) => String(name || '?').split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();

async function getJSON(url, timeout = 15000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  try {
    const res = await fetch(url, { signal: ctl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally { clearTimeout(timer); }
}
let toastTimer;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg; el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 3500);
}
function setHTML(el, html) { if (el._html !== html) { el.innerHTML = html; el._html = html; } }
function stamp() {
  $('updated').textContent = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });
}
const skeletons = (n = 4) => '<div class="skeleton"></div>'.repeat(n);
const logo = (src, cls = '') => (src ? `<img class="logo ${cls}" src="${esc(src)}" alt="" loading="lazy">` : `<span class="logo ${cls}"></span>`);

/* ---------- Normalising ESPN data into one match shape ---------- */
const teamLogo = (t) => (t && (t.logo || (t.logos && t.logos[0] && t.logos[0].href))) || '';
const scoreText = (s) => (s && typeof s === 'object' ? s.displayValue : s) || '';

function normSoccer(ev, leagueName, leagueKey) {
  const comp = (ev.competitions || [])[0] || {};
  const st = comp.status || ev.status || {};
  const type = st.type || {};
  const list = comp.competitors || [];
  const side = (c) => ({
    id: String((c.team && c.team.id) || c.id || ''),
    name: (c.team && (c.team.shortDisplayName || c.team.displayName)) || 'TBC',
    logo: teamLogo(c.team),
    score: scoreText(c.score),
    winner: c.winner === true || c.winner === 'true',
  });
  const home = list.find((c) => c.homeAway === 'home') || list[0] || {};
  const away = list.find((c) => c.homeAway === 'away') || list[1] || {};
  return {
    sport: 'soccer', id: String(ev.id), date: ev.date, state: type.state || 'pre',
    league: leagueName || (ev.league && ev.league.name) || '', leagueKey: leagueKey || (ev.league && ev.league.slug) || 'all',
    status: type.state === 'in' ? (type.shortDetail || st.displayClock) : type.shortDetail || '',
    sides: [side(home), side(away)], sub: '',
  };
}

function normCricket(ev, leagueName, leagueKey) {
  const comp = (ev.competitions || [])[0] || {};
  const type = (ev.status && ev.status.type) || {};
  const list = (comp.competitors || []).slice();
  list.sort((a, b) => (a.homeAway === 'home' ? -1 : 1) - (b.homeAway === 'home' ? -1 : 1));
  return {
    sport: 'cricket', id: String(ev.id), date: ev.date, endDate: ev.endDate || ev.date, state: type.state || 'pre',
    league: leagueName || '', leagueKey: String(ev.leagueId || leagueKey || ''),
    status: type.description || '', title: ev.description || comp.description || '',
    sub: (ev.status && ev.status.summary) || '',
    sides: list.map((c) => ({
      id: String((c.team && c.team.id) || c.id || ''),
      name: (c.team && (c.team.shortDisplayName && c.team.shortDisplayName.length > 5 ? c.team.shortDisplayName : c.team.displayName)) || 'TBC',
      logo: teamLogo(c.team),
      score: c.score || '',
      winner: c.winner === true || c.winner === 'true',
    })),
  };
}

function parseScorepanel(data) {
  const out = [];
  for (const block of data.scores || []) {
    const league = (block.leagues || [])[0] || {};
    for (const ev of block.events || []) out.push(normCricket(ev, league.name, league.id));
  }
  return out;
}

/* Cricket has no team-schedule feed, so upcoming fixtures come from scanning match days. */
let scanPromise = null;
function readScan() {
  try {
    const raw = JSON.parse(localStorage.getItem('matchday.scan') || 'null');
    if (raw && Date.now() - raw.t < SCAN_TTL) return raw.events;
  } catch { /* ignore */ }
  return null;
}
function cricketScan() {
  const cached = readScan();
  if (cached) return Promise.resolve(cached);
  if (scanPromise) return scanPromise;
  scanPromise = (async () => {
    const today = startOfDay(new Date());
    const days = [];
    for (let i = -9; i <= 30; i += 3) days.push(dayKey(addDays(today, i)));
    const found = new Map();
    let ok = 0;
    for (let i = 0; i < days.length; i += 4) {
      const res = await Promise.allSettled(days.slice(i, i + 4).map((d) => getJSON(`${API}/cricket/scorepanel?dates=${d}`)));
      res.forEach((r) => {
        if (r.status !== 'fulfilled') return;
        ok += 1;
        parseScorepanel(r.value).forEach((m) => found.set(m.id, m));
      });
    }
    const events = [...found.values()].sort((a, b) => new Date(a.date) - new Date(b.date));
    if (ok >= days.length / 2) {
      try { localStorage.setItem('matchday.scan', JSON.stringify({ t: Date.now(), events })); } catch { /* quota */ }
    }
    return events;
  })().finally(() => { scanPromise = null; });
  return scanPromise;
}
const hasTeam = (m, id) => m.sides.some((s) => s.id === String(id));
const hasFollowedTeam = (m) => m.sides.some((s) => isFollowed(m.sport, s.id));

/* ---------- Match cards ---------- */
function matchCard(m, opts = {}) {
  const href = m.sport === 'soccer' ? `#/m/soccer/all/${m.id}` : `#/m/cricket/${m.leagueKey}/${m.id}`;
  const done = m.state === 'post';
  const anyWinner = m.sides.some((s) => s.winner);
  const sides = m.sides.map((s) => {
    const cls = done && anyWinner ? (s.winner ? 'win' : 'lose') : '';
    return `<div class="side ${m.sport === 'cricket' ? 'cricket-side' : ''} ${cls}">${logo(s.logo)}
      <span class="name">${esc(s.name)}</span>
      ${m.state === 'pre' ? '' : `<span class="score">${esc(s.score)}</span>`}</div>`;
  }).join('');
  let st;
  if (m.state === 'in') st = `<span class="live-tag">LIVE</span><b>${esc(m.sport === 'soccer' ? m.status : '')}</b>`;
  else if (m.state === 'pre') st = `<b>${esc(timeOf(m.date))}</b>${esc(opts.showDate ? dateOf(m.date) : '')}`;
  else st = `<b>${esc(m.sport === 'soccer' ? m.status : 'Result')}</b>${esc(opts.showDate ? dateOf(m.date) : '')}`;
  const subText = m.sport === 'cricket' ? (m.state === 'pre' ? m.title : m.sub || m.status) : '';
  return `<a class="card match" href="${href}">
    <div class="sides">${sides}</div><div class="state">${st}</div>
    ${opts.showLeague && m.league ? `<div class="match-sub">${esc(m.league)}</div>` : ''}
    ${subText ? `<div class="match-sub ${done ? 'result' : ''}">${esc(subText)}</div>` : ''}
  </a>`;
}
const rank = { in: 0, pre: 1, post: 2 };
const byPlay = (a, b) => rank[a.state] - rank[b.state] || new Date(a.date) - new Date(b.date);

/* ---------- Scores ---------- */
let scoreDay = 0;
async function loadSoccerDay(day) {
  const keys = [dayKey(day), dayKey(addDays(day, -1))];
  const reqs = state.leagues.flatMap((slug) => keys.map((k) => getJSON(`${API}/soccer/${slug}/scoreboard?dates=${k}`)
    .then((d) => ({ slug, d }))));
  const res = await Promise.allSettled(reqs);
  const found = new Map();
  let failed = 0;
  res.forEach((r) => {
    if (r.status !== 'fulfilled') { failed += 1; return; }
    const { slug, d } = r.value;
    const catalog = FOOTBALL_LEAGUES.find(([s]) => s === slug);
    (d.events || []).forEach((ev) => {
      if (dayKey(new Date(ev.date)) !== dayKey(day)) return;
      found.set(ev.id, normSoccer(ev, catalog ? catalog[1] : '', slug));
    });
  });
  return { matches: [...found.values()], failed: failed === res.length && res.length > 0 };
}
async function loadCricketDay(day, offset) {
  const url = offset === 0 ? `${API}/cricket/scorepanel` : `${API}/cricket/scorepanel?dates=${dayKey(day)}`;
  try {
    const data = await getJSON(url);
    const from = day.getTime(), to = addDays(day, 1).getTime();
    return {
      matches: parseScorepanel(data).filter((m) => {
        if (offset === 0 && m.state === 'in') return true;
        return new Date(m.date).getTime() < to && new Date(m.endDate).getTime() >= from;
      }),
    };
  } catch { return { matches: [], failed: true }; }
}
function groupMatches(list) {
  const groups = new Map();
  list.forEach((m) => {
    const key = `${m.sport}:${m.leagueKey}`;
    if (!groups.has(key)) groups.set(key, { sport: m.sport, name: m.league, key: m.leagueKey, items: [] });
    groups.get(key).items.push(m);
  });
  return [...groups.values()].sort((a, b) => {
    const live = (g) => (g.items.some((m) => m.state === 'in') ? 0 : 1);
    return live(a) - live(b) || (a.sport === b.sport ? 0 : a.sport === 'cricket' ? -1 : 1);
  });
}

function scoresControls() {
  const today = startOfDay(new Date());
  const days = [];
  for (let i = -2; i <= 7; i += 1) {
    const d = addDays(today, i);
    const label = i === 0 ? 'Today' : i === -1 ? 'Yest.' : i === 1 ? 'Tom.' : d.toLocaleDateString([], { weekday: 'short' });
    days.push(`<button class="chip day ${i === scoreDay ? 'on' : ''}" data-day="${i}">${label}<small>${d.getDate()} ${d.toLocaleDateString([], { month: 'short' })}</small></button>`);
  }
  const sports = [['all', 'All'], ['cricket', 'Cricket'], ['soccer', 'Football']]
    .map(([k, l]) => `<button class="chip ${state.sport === k ? 'on' : ''}" data-sport="${k}">${l}</button>`).join('');
  return `<div class="chips" id="sportChips">${sports}</div><div class="chips" id="dayChips">${days.join('')}</div>`;
}
async function renderScores(first, token) {
  if (first) {
    view.innerHTML = `<div id="controls"></div><div id="list">${skeletons()}</div>`;
    view._html = null;
    const dc = $('controls');
    dc.innerHTML = scoresControls();
    const on = dc.querySelector('.chip.day.on');
    if (on) on.scrollIntoView({ block: 'nearest', inline: 'center' });
  }
  const day = addDays(startOfDay(new Date()), scoreDay);
  const [soc, cri] = await Promise.all([
    state.sport === 'cricket' ? { matches: [] } : loadSoccerDay(day),
    state.sport === 'soccer' ? { matches: [] } : loadCricketDay(day, scoreDay),
  ]);
  if (token !== routeToken) return false;
  if (soc.failed || cri.failed) toast('Some scores could not load. Showing what came through.');
  let cricket = cri.matches;
  const seriesOn = state.series.map((s) => s.id);
  const filtered = seriesOn.length > 0 && !state.allCricket;
  if (filtered) cricket = cricket.filter((m) => seriesOn.includes(m.leagueKey) || hasFollowedTeam(m));
  const all = [...soc.matches, ...cricket];
  const mine = all.filter(hasFollowedTeam).sort(byPlay);
  const rest = all.filter((m) => !hasFollowedTeam(m));
  let html = '';
  if (mine.length) {
    html += `<section class="group"><h3 class="group-title">&#9733; My teams</h3>${mine.map((m) => matchCard(m, { showLeague: true })).join('')}</section>`;
  }
  html += groupMatches(rest).map((g) => `<section class="group">
    <h3 class="group-title"><span class="sport ${g.sport}"></span>${esc(g.name || (g.sport === 'cricket' ? 'Cricket' : 'Football'))}</h3>
    ${g.items.sort(byPlay).map((m) => matchCard(m)).join('')}</section>`).join('');
  if (!all.length) {
    html = `<div class="empty">No matches ${scoreDay === 0 ? 'today' : 'on this day'} in what you follow.<br><br>
      <a class="btn ghost" href="#/follow">Change leagues</a></div>`;
  }
  if (filtered && state.sport !== 'soccer') {
    html += '<p class="note" style="text-align:center"><button class="link" data-act="all-cricket">Show all cricket</button></p>';
  } else if (state.allCricket && seriesOn.length && state.sport !== 'soccer') {
    html += '<p class="note" style="text-align:center"><button class="link" data-act="all-cricket">Show only my series</button></p>';
  }
  setHTML($('list'), html);
  return all.some((m) => m.state === 'in');
}

/* ---------- My teams ---------- */
async function soccerSchedule(teamId) {
  const [fix, res] = await Promise.allSettled([
    getJSON(`${API}/soccer/all/teams/${teamId}/schedule?fixture=true`),
    getJSON(`${API}/soccer/all/teams/${teamId}/schedule`),
  ]);
  const toList = (r) => (r.status === 'fulfilled' ? (r.value.events || []).map((ev) => normSoccer(ev)) : []);
  const info = (fix.status === 'fulfilled' && fix.value.team) || (res.status === 'fulfilled' && res.value.team) || {};
  const seen = new Map();
  [...toList(res), ...toList(fix)].forEach((m) => seen.set(m.id, m));
  if (fix.status === 'rejected' && res.status === 'rejected') throw new Error('schedule');
  return { matches: [...seen.values()], info };
}
async function renderMine(first, token) {
  if (!state.teams.length) {
    setHTML(view, `<div class="empty">Pick the teams you root for and their fixtures show up here.<br><br>
      <a class="btn" href="#/follow">Choose teams</a></div>`);
    return false;
  }
  const chips = state.teams.map((t) => `<a class="team-chip" href="#/team/${t.sport}/${t.id}">${logo(t.logo, 'md')}<span>${esc(t.name)}</span></a>`).join('');
  if (first) setHTML(view, `<div class="team-chips">${chips}</div>${skeletons(3)}`);
  const soccer = state.teams.filter((t) => t.sport === 'soccer');
  const cricket = state.teams.filter((t) => t.sport === 'cricket');
  const res = await Promise.allSettled([
    ...soccer.map((t) => soccerSchedule(t.id).then((s) => s.matches)),
    cricket.length ? cricketScan() : Promise.resolve([]),
  ]);
  if (token !== routeToken) return false;
  if (res.some((r) => r.status === 'rejected')) toast('Some schedules could not load.');
  const map = new Map();
  res.forEach((r) => {
    if (r.status !== 'fulfilled') return;
    r.value.filter(hasFollowedTeam).forEach((m) => map.set(`${m.sport}${m.id}`, m));
  });
  const all = [...map.values()];
  const live = all.filter((m) => m.state === 'in');
  const upcoming = all.filter((m) => m.state === 'pre').sort((a, b) => new Date(a.date) - new Date(b.date));
  const recent = all.filter((m) => m.state === 'post').sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 6);
  const dayGroups = new Map();
  upcoming.slice(0, 40).forEach((m) => {
    const k = dateOf(m.date);
    if (!dayGroups.has(k)) dayGroups.set(k, []);
    dayGroups.get(k).push(m);
  });
  let html = `<div class="team-chips">${chips}</div>`;
  if (live.length) html += `<section class="group"><h3 class="group-title">Live now</h3>${live.map((m) => matchCard(m, { showLeague: true })).join('')}</section>`;
  html += '<h2 class="section-title">Upcoming</h2>';
  html += dayGroups.size
    ? [...dayGroups].map(([k, ms]) => `<section class="group"><h3 class="group-title">${esc(k)}</h3>${ms.map((m) => matchCard(m, { showLeague: true })).join('')}</section>`).join('')
    : '<p class="empty">No upcoming fixtures found yet.</p>';
  if (cricket.length) html += '<p class="note">Cricket fixtures cover about the next 30 days.</p>';
  if (recent.length) html += `<h2 class="section-title">Recent results</h2>${recent.map((m) => matchCard(m, { showLeague: true, showDate: true })).join('')}`;
  setHTML(view, html);
  return live.length > 0;
}

/* ---------- Follow ---------- */
let followTab = 'soccer', followQuery = '';
const openLeagues = new Set();
const leagueTeams = new Map();
async function teamsForLeague(slug) {
  if (leagueTeams.has(slug)) return leagueTeams.get(slug);
  const data = await getJSON(`${API_V2}/soccer/${slug}/standings`);
  const out = new Map();
  const walk = (node) => {
    if (!node) return;
    ((node.standings && node.standings.entries) || []).forEach((e) => {
      if (e.team) out.set(String(e.team.id), { sport: 'soccer', id: String(e.team.id), name: e.team.shortDisplayName || e.team.displayName, logo: teamLogo({ logo: e.team.logos && e.team.logos[0] && e.team.logos[0].href }), league: slug });
    });
    (node.children || []).forEach(walk);
  };
  walk(data);
  const list = [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
  leagueTeams.set(slug, list);
  return list;
}
const starBtn = (t) => `<button class="star ${isFollowed(t.sport, t.id) ? 'on' : ''}" data-star='${esc(JSON.stringify(t))}' aria-label="${isFollowed(t.sport, t.id) ? 'Unfollow' : 'Follow'} ${esc(t.name)}">${isFollowed(t.sport, t.id) ? '&#9733;' : '&#9734;'}</button>`;
const teamRow = (t, sub = '') => `<div class="row-item">${logo(t.logo)}<a class="grow" href="#/team/${t.sport}/${t.id}${t.league ? `?l=${esc(t.league)}` : ''}">${esc(t.name)}${sub ? `<small>${esc(sub)}</small>` : ''}</a>${starBtn(t)}</div>`;
function followShell() {
  return `<div class="seg"><button class="${followTab === 'soccer' ? 'on' : ''}" data-ftab="soccer">Football</button>
    <button class="${followTab === 'cricket' ? 'on' : ''}" data-ftab="cricket">Cricket</button></div>
    <input class="search" id="followSearch" type="search" placeholder="Search leagues and teams" value="${esc(followQuery)}" aria-label="Search leagues and teams">
    <div id="followBody">${skeletons(3)}</div>`;
}
const matchesQ = (s) => !followQuery || String(s).toLowerCase().includes(followQuery.toLowerCase());
async function renderFollowBody(token) {
  const body = $('followBody');
  if (!body) return;
  if (followTab === 'soccer') {
    const searching = followQuery.length >= 2;
    const slugs = searching ? state.leagues : [...openLeagues];
    await Promise.allSettled(slugs.map(teamsForLeague));
    if (token !== routeToken) return;
    const rows = FOOTBALL_LEAGUES.map(([slug, name]) => {
      const teams = leagueTeams.get(slug) || [];
      const hits = searching ? teams.filter((t) => matchesQ(t.name)) : teams;
      if (followQuery && !matchesQ(name) && !hits.length) return '';
      const open = openLeagues.has(slug) || (searching && hits.length > 0);
      const on = state.leagues.includes(slug);
      let inner = '';
      if (open) {
        inner = hits.length ? `<div class="team-list">${hits.map((t) => teamRow(t)).join('')}</div>`
          : (leagueTeams.has(slug) ? '<p class="note">No team table for this competition right now.</p>' : '<p class="note">Could not load teams.</p>');
      }
      return `<div class="row-item">
        <button class="chev" data-open="${slug}" aria-expanded="${open}" aria-label="Show ${esc(name)} teams">${open ? '&#9662;' : '&#9656;'}</button>
        <span class="grow">${esc(name)}</span>
        <button class="switch ${on ? 'on' : ''}" data-league="${slug}" role="switch" aria-checked="${on}" aria-label="Show ${esc(name)} on Scores"></button>
      </div>${inner}`;
    }).join('');
    setHTML(body, `<div class="card">${rows || '<p class="empty">Nothing matches that search.</p>'}</div>
      <p class="note">The switch shows a league on Scores. Open a league to star your teams.</p>`);
    return;
  }
  setHTML(body, `<h2 class="section-title">National teams</h2><div class="card">${CRICKET_NATIONS.filter((t) => matchesQ(t.name)).map((t) => teamRow(t)).join('')}</div><p class="note">Looking for this month's series and teams...</p>`);
  let events = [];
  try { events = await cricketScan(); } catch { toast('Could not load cricket series.'); }
  if (token !== routeToken || followTab !== 'cricket') return;
  const series = new Map(), teams = new Map();
  const nations = new Set(CRICKET_NATIONS.map((t) => t.id));
  events.forEach((m) => {
    if (m.leagueKey && !series.has(m.leagueKey)) series.set(m.leagueKey, { id: m.leagueKey, name: m.league, n: 0 });
    if (series.has(m.leagueKey)) series.get(m.leagueKey).n += 1;
    m.sides.forEach((s) => {
      if (!nations.has(s.id) && !teams.has(s.id)) teams.set(s.id, { sport: 'cricket', id: s.id, name: s.name, logo: s.logo, from: m.league });
    });
  });
  const seriesRows = [...series.values()].filter((s) => s.name && matchesQ(s.name)).sort((a, b) => a.name.localeCompare(b.name)).map((s) => {
    const on = state.series.some((x) => x.id === s.id);
    return `<div class="row-item"><span class="grow">${esc(s.name)}<small>${s.n} match${s.n === 1 ? '' : 'es'} around now</small></span>
      <button class="switch ${on ? 'on' : ''}" data-series="${esc(s.id)}" data-name="${esc(s.name)}" role="switch" aria-checked="${on}" aria-label="Show ${esc(s.name)} on Scores"></button></div>`;
  }).join('');
  const teamRows = [...teams.values()].filter((t) => matchesQ(t.name) || matchesQ(t.from)).sort((a, b) => a.name.localeCompare(b.name)).slice(0, followQuery ? 60 : 30)
    .map(({ from, ...t }) => teamRow(t, from)).join('');
  setHTML(body, `<h2 class="section-title">National teams</h2><div class="card">${CRICKET_NATIONS.filter((t) => matchesQ(t.name)).map((t) => teamRow(t)).join('') || '<p class="note">No match.</p>'}</div>
    <h2 class="section-title">Series and leagues</h2><div class="card">${seriesRows || '<p class="note">No series found.</p>'}</div>
    <p class="note">With no series switched on, Scores shows all cricket.</p>
    <h2 class="section-title">Other teams playing now</h2><div class="card">${teamRows || '<p class="note">No teams found.</p>'}</div>
    ${followQuery ? '' : '<p class="note">Search to see more. League sides such as IPL teams appear here once their season is within about 30 days.</p>'}`);
}
async function renderFollow(first, token) {
  if (first) { setHTML(view, followShell()); await renderFollowBody(token); }
  return false;
}

/* ---------- Team ---------- */
let teamTab = 'fixtures';
function mostCommonLeague(matches) {
  const counts = new Map();
  matches.forEach((m) => { if (m.leagueKey && m.leagueKey !== 'all') counts.set(m.leagueKey, (counts.get(m.leagueKey) || 0) + 1); });
  return [...counts].sort((a, b) => b[1] - a[1]).map(([slug]) => slug)[0] || '';
}
async function renderTeam(first, token, sport, id, leagueSlug) {
  if (first) { setHTML(view, skeletons(3)); teamTab = 'fixtures'; }
  let matches = [], players = [], name = '', teamLogoUrl = '', squadNote = '', meta = '';
  const known = state.teams.find((t) => t.sport === sport && t.id === id) || CRICKET_NATIONS.find((t) => sport === 'cricket' && t.id === id);
  if (known) { name = known.name; teamLogoUrl = known.logo; }
  if (sport === 'soccer') {
    const [sched] = await Promise.allSettled([soccerSchedule(id)]);
    if (sched.status === 'fulfilled') {
      matches = sched.value.matches;
      const info = sched.value.info;
      name = info.displayName || name; teamLogoUrl = info.logo || teamLogoUrl;
      meta = [info.standingSummary, info.recordSummary && `Record ${info.recordSummary}`].filter(Boolean).join(' · ');
    }
    // The roster feed needs a real league, so use the one this team plays in most.
    if (!leagueSlug) leagueSlug = (known && known.league) || mostCommonLeague(matches);
    const [roster] = await Promise.allSettled([getJSON(`${API}/soccer/${leagueSlug || 'all'}/teams/${id}/roster`)]);
    if (roster.status === 'fulfilled') {
      players = (roster.value.athletes || []).map((a) => ({
        id: a.id, name: a.displayName, num: a.jersey || '',
        sub: [a.position && a.position.displayName, a.age && `${a.age} yrs`, a.citizenship].filter(Boolean).join(' · '),
        group: (a.position && a.position.displayName) || 'Squad',
      }));
    }
  } else {
    const events = await cricketScan().catch(() => []);
    matches = events.filter((m) => hasTeam(m, id));
    const side = matches.length ? matches[0].sides.find((s) => s.id === id) : null;
    if (side && !name) { name = side.name; teamLogoUrl = side.logo; }
    const order = matches.filter((m) => m.state !== 'pre').sort((a, b) => new Date(b.date) - new Date(a.date))
      .concat(matches.filter((m) => m.state === 'pre'));
    for (const m of order.slice(0, 4)) {
      try {
        const sum = await getJSON(`${API}/cricket/${m.leagueKey}/summary?event=${m.id}`);
        const list = cricketSquad(sum, id);
        if (list.length) { players = list; squadNote = `Squad from ${m.title || m.league}`; break; }
      } catch { /* try next match */ }
    }
  }
  if (token !== routeToken) return false;
  $('title').textContent = name || 'Team';
  const upcoming = matches.filter((m) => m.state !== 'post').sort(byPlay);
  const results = matches.filter((m) => m.state === 'post').sort((a, b) => new Date(b.date) - new Date(a.date));
  const team = { sport, id, name, logo: teamLogoUrl, league: leagueSlug || undefined };
  const tabs = [['fixtures', 'Fixtures'], ['results', 'Results'], ['squad', sport === 'soccer' ? 'Squad' : 'Players']]
    .map(([k, l]) => `<button class="${teamTab === k ? 'on' : ''}" data-ttab="${k}">${l}</button>`).join('');
  let body = '';
  if (teamTab === 'fixtures') {
    body = upcoming.length ? upcoming.slice(0, 30).map((m) => matchCard(m, { showDate: true, showLeague: true })).join('')
      : `<p class="empty">No upcoming fixtures found${sport === 'cricket' ? ' in the next 30 days' : ''}.</p>`;
  } else if (teamTab === 'results') {
    body = results.length ? results.slice(0, 30).map((m) => matchCard(m, { showDate: true, showLeague: true })).join('') : '<p class="empty">No recent results found.</p>';
  } else if (!players.length) {
    body = `<p class="empty">${sport === 'cricket' ? 'No squad published for this team\'s current matches yet.' : 'Squad list is not available right now.'}</p>`;
  } else {
    const groups = new Map();
    players.forEach((p) => { const g = p.group || 'Squad'; if (!groups.has(g)) groups.set(g, []); groups.get(g).push(p); });
    body = (squadNote ? `<p class="note">${esc(squadNote)}</p>` : '') + [...groups].map(([g, ps]) => `<h3 class="section-title">${esc(g)}</h3>
      <div class="card">${ps.map((p) => playerRow(sport, p)).join('')}</div>`).join('');
  }
  setHTML(view, `<div class="card profile">${logo(teamLogoUrl, 'lg')}<div style="flex:1;min-width:0"><h2>${esc(name)}</h2>${meta ? `<small>${esc(meta)}</small>` : ''}</div>${starBtn(team)}</div>
    <div class="seg">${tabs}</div>${body}`);
  return matches.some((m) => m.state === 'in');
}
const playerRow = (sport, p) => `<a class="player" href="#/p/${sport}/${p.id}">
  <span class="num">${esc(p.num || '')}</span>
  <span class="info"><b>${esc(p.name)}${p.tags ? `<span class="tag">${esc(p.tags)}</span>` : ''}</b><small>${esc(p.sub || '')}</small></span>
  ${p.marks ? `<span class="marks">${p.marks}</span>` : ''}</a>`;

/* Cricket player role text comes in a few shapes across the feeds. */
function cricketPlayer(a, entry = {}) {
  const pos = (a.position && a.position.name) || (entry.position && entry.position.name);
  const styles = (a.style || []).map((s) => s.shortDescription || s.description).filter(Boolean);
  const tags = [(entry.captain || a.captain) && 'C', a.keeper && 'WK'].filter(Boolean).join(' ');
  return {
    id: a.id, name: a.displayName, tags,
    sub: [pos && pos !== 'Unknown' ? pos : '', ...styles].filter(Boolean).join(' · '),
  };
}
function cricketSquad(sum, teamId) {
  const roster = (sum.rosters || []).find((r) => String(r.team && r.team.id) === String(teamId));
  if (roster && roster.roster && roster.roster.length) {
    const xi = roster.roster.filter((p) => p.starter !== false);
    return xi.map((p) => ({ ...cricketPlayer(p.athlete, p), group: 'Playing XI' }));
  }
  const squad = (sum.squads || []).find((s) => String(s.team && s.team.id) === String(teamId));
  return ((squad && squad.athletes) || []).map((a) => ({ ...cricketPlayer(a), group: 'Squad' }));
}

/* ---------- Match ---------- */
let matchTab = null, lastSummary = null, timelineFilter = 'all', chosenInnings = null;

async function renderMatch(first, token, sport, league, id) {
  if (first) { matchTab = null; timelineFilter = 'all'; chosenInnings = null; lastSummary = null; setHTML(view, skeletons(3)); }
  const sum = await getJSON(`${API}/${sport === 'soccer' ? 'soccer/all' : `cricket/${league}`}/summary?event=${id}`);
  if (token !== routeToken) return false;
  lastSummary = sum;
  return sport === 'soccer' ? renderSoccerMatch(sum, id) : renderCricketMatch(sum, league, id, token);
}

/* Football */
const EVT = [
  [/own goal/i, '&#9917;', 'goal'], [/penalty.*(missed|saved)|missed penalty/i, '&#10060;', ''],
  [/goal|penalty - scored/i, '&#9917;', 'goal'], [/yellow/i, '&#129000;', ''],
  [/red card/i, '&#128997;', ''], [/substitution/i, '&#128257;', ''], [/var/i, '&#128250;', ''],
];
function soccerTimeline(sum) {
  const items = (sum.keyEvents || []).slice().reverse();
  if (!items.length) return '<p class="empty">The timeline starts at kick-off.</p>';
  return `<ul class="tl">${items.map((e) => {
    const type = (e.type && e.type.text) || '';
    const hit = EVT.find(([re]) => re.test(type));
    const clock = (e.clock && e.clock.displayValue) || '';
    if (!hit) return `<li><span class="t">${esc(clock)}</span><span class="d">${esc(strip(e.text) || type)}</span></li>`;
    const who = (e.participants || []).map((p) => p.athlete && p.athlete.displayName).filter(Boolean);
    return `<li class="${hit[2]}"><span class="t">${esc(clock)}</span><div><div class="h">${hit[1]} ${esc(who.join(' / ') || type)}</div>
      <div class="d">${esc(strip(e.text))}</div></div></li>`;
  }).join('')}</ul>`;
}
function soccerCommentary(sum) {
  const items = (sum.commentary || []).slice().reverse();
  if (!items.length) return '<p class="empty">No commentary yet.</p>';
  return `<ul class="tl">${items.map((c) => `<li><span class="t">${esc((c.time && c.time.displayValue) || '')}</span><span class="d">${esc(strip(c.text))}</span></li>`).join('')}</ul>`;
}
const statOf = (p, name) => { const s = (p.stats || []).find((x) => x.name === name); return s ? s.value : 0; };
function soccerLineups(sum) {
  const rosters = sum.rosters || [];
  if (!rosters.length || !rosters.some((r) => (r.roster || []).length)) {
    return '<p class="empty">Lineups usually appear about an hour before kick-off.</p>';
  }
  return rosters.map((r) => {
    const row = (p) => {
      const marks = [
        '&#9917;'.repeat(statOf(p, 'totalGoals')), statOf(p, 'goalAssists') ? `<small>${statOf(p, 'goalAssists')}A</small>` : '',
        statOf(p, 'yellowCards') ? '&#129000;' : '', statOf(p, 'redCards') ? '&#128997;' : '',
        p.subbedOut ? '&#8595;' : '', p.subbedIn ? '&#8593;' : '',
      ].join(' ').trim();
      return playerRow('soccer', {
        id: p.athlete.id, name: p.athlete.displayName, num: p.jersey,
        sub: (p.position && p.position.displayName) || '', marks,
      });
    };
    const starters = r.roster.filter((p) => p.starter);
    const bench = r.roster.filter((p) => !p.starter);
    return `<h3 class="section-title">${esc(r.team.displayName)}${r.formation ? ` · ${esc(r.formation)}` : ''}</h3>
      <div class="card">${starters.map(row).join('')}</div>
      ${bench.length ? `<details class="card"><summary>Substitutes (${bench.length})</summary>${bench.map(row).join('')}</details>` : ''}`;
  }).join('');
}
function soccerStats(sum) {
  const [a, b] = ((sum.boxscore && sum.boxscore.teams) || []);
  if (!a || !a.statistics || !a.statistics.length) return '<p class="empty">Stats appear once the match starts.</p>';
  const labels = { SHOTS: 'Shots', 'ON GOAL': 'Shots on target' };
  const rows = a.statistics.map((s) => {
    const o = ((b && b.statistics) || []).find((x) => x.name === s.name);
    if (!o || (/pct/i.test(s.name) && !/possession/i.test(s.name))) return '';
    s = { ...s, label: labels[s.label] || s.label };
    const x = parseFloat(s.displayValue) || 0, y = parseFloat(o.displayValue) || 0;
    const total = x + y || 1;
    return `<div class="stat"><div class="row"><span>${esc(s.displayValue)}</span><span>${esc(s.label || s.name)}</span><span>${esc(o.displayValue)}</span></div>
      <div class="bars"><i style="flex:${x / total || .001}"></i><i style="flex:${y / total || .001}"></i></div></div>`;
  }).join('');
  return `<div class="card"><div class="stat"><div class="row"><b>${esc(a.team.abbreviation)}</b><b>${esc(b.team.abbreviation)}</b></div></div>${rows}</div>`;
}
function infoTab(sum, extra = []) {
  const g = sum.gameInfo || {};
  const v = g.venue || {};
  const rows = [
    ...extra,
    ['Venue', v.fullName], ['City', v.address && [v.address.city, v.address.country].filter(Boolean).join(', ')],
    ['Attendance', g.attendance ? Number(g.attendance).toLocaleString() : ''],
    ['Officials', (g.officials || []).map((o) => o.displayName || o.fullName).filter(Boolean).join(', ')],
  ].filter((r) => r[1]);
  return `<div class="card"><dl class="dl">${rows.map(([k, val]) => `<dt>${esc(k)}</dt><dd>${esc(val)}</dd>`).join('')}</dl></div>`;
}
function matchTabs(list) {
  if (!matchTab || !list.some(([k]) => k === matchTab)) matchTab = list[0][0];
  return `<div class="seg">${list.map(([k, l]) => `<button class="${matchTab === k ? 'on' : ''}" data-mtab="${k}">${l}</button>`).join('')}</div>`;
}
function renderSoccerMatch(sum, id) {
  const comp = sum.header.competitions[0];
  const type = (comp.status && comp.status.type) || {};
  const live = type.state === 'in';
  const list = comp.competitors || [];
  const home = list.find((c) => c.homeAway === 'home') || list[0];
  const away = list.find((c) => c.homeAway === 'away') || list[1];
  const slug = sum.header.league && sum.header.league.slug;
  const tm = (c) => `<a class="tm" href="#/team/soccer/${c.team.id}${slug ? `?l=${esc(slug)}` : ''}">${logo(teamLogo(c.team), 'lg')}<span>${esc(c.team.displayName)}</span></a>`;
  const middle = type.state === 'pre'
    ? `<div><div class="big" style="font-size:20px">${esc(timeOf(comp.date))}</div><div class="vs">${esc(dateOf(comp.date))}</div></div>`
    : `<div class="big">${esc(home.score ?? 0)} - ${esc(away.score ?? 0)}</div>`;
  const goals = (sum.keyEvents || []).filter((e) => e.scoringPlay).map((e) => `${(e.participants || [{}])[0].athlete?.displayName || ''} ${e.clock?.displayValue || ''}`).join(' · ');
  $('title').textContent = (sum.header.league && sum.header.league.name) || 'Match';
  const tabs = matchTabs([['timeline', 'Timeline'], ['lineups', 'Lineups'], ['stats', 'Stats'], ['commentary', 'Commentary'], ['info', 'Info']]);
  const body = { timeline: soccerTimeline, lineups: soccerLineups, stats: soccerStats, commentary: soccerCommentary, info: infoTab }[matchTab](sum);
  setHTML(view, `<section class="card hero"><div class="teams">${tm(home)}${middle}${tm(away)}</div>
    <div class="status">${live ? '<span class="live-tag">LIVE</span> ' : ''}${esc(type.shortDetail || type.description || '')}</div>
    ${goals ? `<div class="scorers">${esc(goals)}</div>` : ''}</section>${tabs}${body}`);
  return live;
}

/* Cricket */
function inningsOf(sum) {
  const out = [];
  (sum.header.competitions[0].competitors || []).forEach((c) => {
    (c.linescores || []).forEach((l) => {
      if (l.isBatting || l.runs > 0 || l.wickets > 0) {
        out.push({ period: l.period, team: c.team, runs: l.runs, wickets: l.wickets, overs: l.overs, current: !!l.isCurrent, target: l.target });
      }
    });
  });
  return out.sort((a, b) => a.period - b.period);
}
const inningsText = (i) => `${i.runs}/${i.wickets}${i.overs ? ` (${i.overs} ov)` : ''}`;
const statsMap = (ls) => {
  const m = {};
  const cats = ls && ls.statistics && ls.statistics.categories;
  if (Array.isArray(cats)) cats.forEach((c) => { if (Array.isArray(c.stats)) c.stats.forEach((s) => { m[s.name] = s.displayValue; }); });
  return m;
};
function collectScorecard(sum) {
  const byPeriod = {};
  (sum.rosters || []).forEach((r) => {
    (r.roster || []).forEach((p) => {
      (p.linescores || []).forEach((outer) => {
        const inner = (outer.linescores && outer.linescores.length ? outer.linescores : [outer]);
        inner.forEach((ls) => {
          const s = statsMap(ls);
          const box = byPeriod[outer.period] = byPeriod[outer.period] || { bat: [], bowl: [] };
          const st = ls.statistics || {};
          if (s.batted === '1') box.bat.push({ p, s, info: st.batting || {}, order: Number(s.battingPosition) || 99, team: r.team });
          if (s.conceded !== undefined && s.bowled === '1') box.bowl.push({ p, s, order: Number(s.bowlingPosition) || 99 });
        });
      });
    });
  });
  return byPeriod;
}
function cricketScorecard(sum) {
  const inns = inningsOf(sum);
  const cards = collectScorecard(sum);
  if (!inns.length) return '<p class="empty">The scorecard appears once play starts.</p>';
  return inns.slice().reverse().map((inn) => {
    const box = cards[inn.period] || { bat: [], bowl: [] };
    const bat = box.bat.sort((a, b) => a.order - b.order).map(({ p, s, info }) => {
      const out = info.outDetails && info.outDetails.shortText;
      const active = info.active || (!out && s.dismissal === '0');
      return `<tr class="${info.active ? 'batting' : ''}"><td><a href="#/p/cricket/${p.athlete.id}">${esc(p.athlete.displayName)}</a><small>${esc(out || (active ? 'not out' : ''))}</small></td>
        <td><b>${esc(s.runs)}</b></td><td>${esc(s.ballsFaced)}</td><td>${esc(s.fours)}</td><td>${esc(s.sixes)}</td><td>${esc(s.strikeRate)}</td></tr>`;
    }).join('');
    const bowl = box.bowl.sort((a, b) => a.order - b.order).map(({ p, s }) => `<tr><td><a href="#/p/cricket/${p.athlete.id}">${esc(p.athlete.displayName)}</a></td>
      <td>${esc(s.overs)}</td><td>${esc(s.maidens)}</td><td>${esc(s.conceded)}</td><td><b>${esc(s.wickets)}</b></td><td>${esc(s.economyRate)}</td></tr>`).join('');
    const falls = box.bat.filter((b) => b.info.outDetails && b.info.outDetails.details && b.info.outDetails.details.innings)
      .map((b) => ({ d: b.info.outDetails.details, name: b.p.athlete.displayName }))
      .sort((a, b) => a.d.innings.wickets - b.d.innings.wickets)
      .map(({ d, name }) => `${d.innings.wickets}-${d.innings.runs} (${name}, ${d.over ? d.over.overs : ''})`).join(', ');
    return `<h3 class="section-title">${esc(inn.team.displayName)} · ${esc(inningsText(inn))}</h3>
      <div class="card">
        ${bat ? `<div class="table-wrap"><table><thead><tr><th>Batter</th><th>R</th><th>B</th><th>4s</th><th>6s</th><th>SR</th></tr></thead><tbody>${bat}</tbody></table></div>` : '<p class="note">Batting details are not in yet.</p>'}
        ${bowl ? `<div class="table-wrap" style="margin-top:10px"><table><thead><tr><th>Bowler</th><th>O</th><th>M</th><th>R</th><th>W</th><th>Econ</th></tr></thead><tbody>${bowl}</tbody></table></div>` : ''}
        ${falls ? `<p class="note"><b>Fall of wickets:</b> ${esc(falls)}</p>` : ''}
      </div>`;
  }).join('');
}
function cricketSquads(sum) {
  const teams = sum.header.competitions[0].competitors || [];
  const lists = teams.map((c) => ({ team: c.team, players: cricketSquad(sum, c.team.id) }));
  if (!lists.some((l) => l.players.length)) return '<p class="empty">Squads have not been announced yet.</p>';
  return lists.map((l) => `<h3 class="section-title"><a href="#/team/cricket/${l.team.id}">${esc(l.team.displayName)}</a></h3>
    <div class="card">${l.players.map((p) => playerRow('cricket', p)).join('') || '<p class="note">Not announced yet.</p>'}</div>`).join('');
}
function ballClass(b) {
  if (b.dismissal && b.dismissal.dismissal) return ['W', 'w'];
  const d = ((b.playType && b.playType.description) || '').toLowerCase();
  const runs = b.scoreValue || 0;
  if (d.includes('wide')) return [`${runs > 1 ? runs : ''}wd`, ''];
  if (d.includes('no ball')) return [`${runs > 1 ? runs : ''}nb`, ''];
  if (d.includes('leg bye')) return [`${runs}lb`, ''];
  if (d.includes('bye')) return [`${runs}b`, ''];
  if (runs === 6) return ['6', 'b6'];
  if (runs === 4) return ['4', 'b4'];
  return [String(runs), ''];
}
function ballRow(b) {
  const [txt, cls] = ballClass(b);
  const kind = cls === 'w' ? 'wicket' : cls ? 'boundary' : '';
  const pre = b.preText ? `<div class="d">${esc(strip(b.preText).slice(0, 280))}</div>` : '';
  const over = b.over ? (b.over.overs ?? '') : '';
  return `<li class="${kind}"><span class="t">${esc(over)}</span><div>
    <div class="h"><span class="ball ${cls}" style="margin-right:6px">${esc(txt)}</span>${esc(strip(b.shortText))}</div>
    ${b.text ? `<div class="d">${esc(strip(b.text))}</div>` : ''}${b.dismissal && b.dismissal.text ? `<div class="d"><b>${esc(strip(b.dismissal.text))}</b></div>` : ''}${pre}</div></li>`;
}
const commentaryCache = new Map();
async function loadBalls(league, id, period) {
  const base = `${API}/cricket/${league}/playbyplay?event=${id}&period=${period}`;
  const first = await getJSON(`${base}&page=1`);
  const pages = (first.commentary && first.commentary.pageCount) || 1;
  const want = [pages, pages - 1, pages - 2].filter((p) => p > 1);
  const rest = await Promise.allSettled(want.map((p) => getJSON(`${base}&page=${p}`)));
  const items = [...(first.commentary.items || [])];
  rest.forEach((r) => { if (r.status === 'fulfilled') items.push(...(r.value.commentary.items || [])); });
  const seen = new Map();
  items.forEach((b) => seen.set(b.id, b));
  return { balls: [...seen.values()].sort((a, b) => a.sequence - b.sequence), truncated: pages > 4 };
}
function atCrease(balls, live) {
  const last = [...balls].reverse().find((b) => b.batsman && b.bowler);
  if (!last || !live) return '';
  const bat = (x) => (x && x.athlete ? `<tr><td><a href="#/p/cricket/${x.athlete.id}">${esc(x.athlete.displayName)}</a></td><td><b>${esc(x.totalRuns ?? '')}</b></td><td>${esc(x.faced ?? '')}</td><td>${esc(x.fours ?? '')}</td><td>${esc(x.sixes ?? '')}</td></tr>` : '');
  const out = last.dismissal && last.dismissal.dismissal;
  const bw = last.bowler;
  const recent = balls.slice(-12).filter((b) => b.playType).map((b) => { const [t, c] = ballClass(b); return `<span class="ball ${c}">${esc(t)}</span>`; }).join('');
  const rr = last.innings && last.innings.runRate;
  return `<div class="card"><div class="table-wrap"><table><thead><tr><th>At the crease</th><th>R</th><th>B</th><th>4s</th><th>6s</th></tr></thead>
    <tbody>${out ? '' : bat(last.batsman)}${bat(last.otherBatsman)}</tbody></table></div>
    <p class="note">Bowling: ${bw.athlete ? `<a class="link" href="#/p/cricket/${bw.athlete.id}">${esc(bw.athlete.displayName)}</a>` : ''} ${esc(bw.overs ?? '')}-${esc(bw.maidens ?? 0)}-${esc(bw.conceded ?? '')}-${esc(bw.wickets ?? '')}${rr ? ` · Run rate ${esc(rr)}` : ''}</p>
    <div class="balls">${recent}</div></div>`;
}
async function cricketTimeline(sum, league, id, live) {
  const inns = inningsOf(sum);
  if (!inns.length) return '<p class="empty">Ball-by-ball starts with the first delivery.</p>';
  const period = chosenInnings || inns[inns.length - 1].period;
  const chips = inns.length > 1 ? `<div class="chips">${inns.map((i) => `<button class="chip ${i.period === period ? 'on' : ''}" data-inn="${i.period}">${esc(i.team.abbreviation)} ${esc(i.runs)}/${esc(i.wickets)}</button>`).join('')}</div>` : '';
  const filters = `<div class="chips">${[['all', 'All balls'], ['wicket', 'Wickets'], ['boundary', 'Fours and sixes']].map(([k, l]) => `<button class="chip ${timelineFilter === k ? 'on' : ''}" data-tf="${k}">${l}</button>`).join('')}</div>`;
  let data = { balls: [] };
  try {
    data = await loadBalls(league, id, period);
    commentaryCache.set(`${id}:${period}`, data);
  } catch {
    data = commentaryCache.get(`${id}:${period}`) || data;
  }
  const isCurrent = period === inns[inns.length - 1].period;
  const shown = data.balls.slice().reverse().filter((b) => {
    if (timelineFilter === 'all') return true;
    const c = ballClass(b)[1];
    return timelineFilter === 'wicket' ? c === 'w' : c === 'b4' || c === 'b6';
  });
  return `${chips}${isCurrent ? atCrease(data.balls, live) : ''}${filters}
    ${shown.length ? `<div class="card"><ul class="tl">${shown.map(ballRow).join('')}</ul></div>` : '<p class="empty">Nothing here yet.</p>'}
    ${data.truncated ? '<p class="note">Showing the latest deliveries of this innings.</p>' : ''}`;
}
async function renderCricketMatch(sum, league, id, token) {
  const comp = sum.header.competitions[0];
  const st = comp.status || {};
  const type = st.type || {};
  const live = type.state === 'in';
  const inns = inningsOf(sum);
  const list = (comp.competitors || []).slice().sort((a, b) => (a.homeAway === 'home' ? -1 : 1) - (b.homeAway === 'home' ? -1 : 1));
  const tm = (c) => {
    const text = inns.filter((i) => i.team.id === c.team.id).map(inningsText).join(' & ');
    return `<a class="tm" href="#/team/cricket/${c.team.id}">${logo(teamLogo(c.team), 'lg')}<span>${esc(c.team.displayName)}</span><span class="cscore">${esc(text || (type.state === 'pre' ? '' : 'Yet to bat'))}</span></a>`;
  };
  const middle = type.state === 'pre' ? `<div><div class="big" style="font-size:20px">${esc(timeOf(comp.date))}</div><div class="vs">${esc(dateOf(comp.date))}</div></div>` : '<div class="vs">v</div>';
  $('title').textContent = (sum.header.league && sum.header.league.name) || sum.header.title || 'Match';
  const tabs = matchTabs([['timeline', 'Ball by ball'], ['scorecard', 'Scorecard'], ['squads', 'Squads'], ['info', 'Info']]);
  let body;
  if (matchTab === 'timeline') body = await cricketTimeline(sum, league, id, live);
  else if (matchTab === 'scorecard') body = cricketScorecard(sum);
  else if (matchTab === 'squads') body = cricketSquads(sum);
  else {
    const labels = { matchdays: 'Days', hoursofplay: 'Hours of play', season: 'Season', matchnumber: 'Match' };
    const notes = (sum.notes || []).filter((n) => labels[n.type]).map((n) => [labels[n.type], strip(n.text)]);
    body = infoTab(sum, [['Match', sum.header.description], ['Status', st.summary], ...notes.filter((n) => n[0] !== 'Match')]);
  }
  if (token !== routeToken) return false;
  setHTML(view, `<section class="card hero"><div class="teams">${tm(list[0])}${middle}${tm(list[1])}</div>
    <div class="status ${type.state === 'post' ? 'result' : ''}">${live ? `<span class="live-tag">${esc(type.description || 'LIVE')}</span> ` : ''}${esc(st.summary || type.description || '')}</div>
    ${st.session ? `<div class="scorers">${esc(st.session)}</div>` : ''}</section>${tabs}${body}`);
  return live;
}

/* ---------- Player ---------- */
const styleText = (v) => (Array.isArray(v) ? v.map((s) => s.description || s.text || s).join(', ') : (v && (v.description || v.text)) || v || '');
function matchLine(sport, id) {
  if (!lastSummary) return '';
  for (const r of lastSummary.rosters || []) {
    const p = (r.roster || []).find((x) => String(x.athlete && x.athlete.id) === String(id));
    if (!p) continue;
    if (sport === 'soccer') {
      const rows = (p.stats || []).filter((s) => s.value && !/appearances/i.test(s.name)).map((s) => [s.displayName, s.displayValue]);
      return rows.length ? `<h3 class="section-title">In this match</h3><div class="card"><dl class="dl">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl></div>` : '';
    }
    const lines = [];
    (p.linescores || []).forEach((o) => (o.linescores || []).forEach((ls) => {
      const s = statsMap(ls);
      if (s.batted === '1') lines.push(['Batting', `${s.runs} (${s.ballsFaced}), ${s.fours} fours, ${s.sixes} sixes`]);
      if (s.bowled === '1') lines.push(['Bowling', `${s.overs}-${s.maidens}-${s.conceded}-${s.wickets}`]);
    }));
    return lines.length ? `<h3 class="section-title">In this match</h3><div class="card"><dl class="dl">${lines.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl></div>` : '';
  }
  return '';
}
async function renderPlayer(first, token, sport, id) {
  if (first) setHTML(view, skeletons(2));
  const [core, overview] = await Promise.allSettled([
    getJSON(`${ATHLETES}/${sport}/athletes/${id}`),
    sport === 'soccer' ? getJSON(`${ATHLETES}/soccer/athletes/${id}/overview`) : Promise.resolve(null),
  ]);
  if (token !== routeToken) return false;
  if (core.status !== 'fulfilled') throw new Error('player');
  const a = core.value.athlete;
  $('title').textContent = a.displayName;
  const img = a.headshot && a.headshot.href && !/default-player/.test(a.headshot.href) ? a.headshot.href : '';
  const avatar = img ? `<img class="avatar" src="${esc(img)}" alt="">` : `<div class="avatar txt">${esc(initials(a.displayName))}</div>`;
  const pos = a.position && (a.position.displayName || a.position.name);
  const bio = [
    ['Team', a.team && a.team.displayName], ['Position', pos],
    ['Shirt', a.displayJersey || a.jersey], ['Age', a.age], ['Born', a.displayDOB],
    ['Birthplace', a.displayBirthPlace], ['Nationality', a.citizenship || (a.flag && a.flag.alt)],
    ['Height', a.displayHeight], ['Weight', a.displayWeight],
    ['Batting', styleText(a.batStyle)], ['Bowling', styleText(a.bowlStyle)],
  ].filter((r) => r[1]);
  let season = '';
  const summary = a.statsSummary && a.statsSummary.statistics;
  if (summary && summary.length) {
    season = `<h3 class="section-title">${esc(a.statsSummary.displayName || 'Season')}</h3><div class="card"><dl class="dl">
      ${summary.map((s) => `<dt>${esc(s.displayName)}</dt><dd>${esc(s.displayValue)}</dd>`).join('')}</dl></div>`;
  }
  let comps = '';
  const ov = overview.status === 'fulfilled' && overview.value && overview.value.statistics;
  if (ov && ov.splits && ov.splits.length) {
    const want = ['starts', 'totalGoals', 'goalAssists', 'yellowCards', 'redCards'];
    const idx = want.map((n) => [n, ov.names.indexOf(n)]).filter((x) => x[1] >= 0);
    comps = `<h3 class="section-title">By competition</h3><div class="card table-wrap"><table><thead><tr><th>Competition</th>${idx.map(([, i]) => `<th>${esc(ov.labels[i])}</th>`).join('')}</tr></thead>
      <tbody>${ov.splits.map((s) => `<tr><td>${esc(s.displayName)}</td>${idx.map(([, i]) => `<td>${esc(s.stats[i])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  }
  const profile = sport === 'cricket' && (a.links || []).find((l) => (l.rel || []).includes('playercard'));
  setHTML(view, `<div class="card profile">${avatar}<div><h2>${esc(a.displayName)}</h2><small>${esc([pos, a.team && a.team.displayName].filter(Boolean).join(' · '))}</small></div></div>
    ${matchLine(sport, id)}${season}${comps}
    <h3 class="section-title">Details</h3><div class="card"><dl class="dl">${bio.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl></div>
    ${profile ? `<p class="note">Career stats are not in the live feed. <a class="link" href="${esc(profile.href)}" target="_blank" rel="noopener">Open full Cricinfo profile</a></p>` : ''}`);
  return false;
}

/* ---------- Router and polling ---------- */
let routeToken = 0, pollTimer = null;
function parseRoute() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [path, query] = raw.split('?');
  const parts = path.split('/').filter(Boolean);
  return { parts, query: new URLSearchParams(query || '') };
}
const safe = (s) => /^[\w.-]+$/.test(s || '');
async function run(first) {
  clearTimeout(pollTimer);
  const token = routeToken;
  const { parts, query } = parseRoute();
  const [name, a, b, c] = parts;
  let live = false, poll = IDLE_POLL;
  document.querySelectorAll('[data-nav]').forEach((el) => {
    const on = el.dataset.nav === (name === 'mine' || name === 'follow' ? name : !name ? 'scores' : '');
    el.classList.toggle('on', on);
    if (on) el.setAttribute('aria-current', 'page'); else el.removeAttribute('aria-current');
  });
  const isDetail = ['m', 'team', 'p'].includes(name);
  $('back').hidden = !isDetail;
  if (first) {
    $('title').textContent = { mine: 'My teams', follow: 'Follow' }[name] || (isDetail ? '' : 'Matchday');
    window.scrollTo(0, 0);
    $('updated').textContent = '';
  }
  try {
    if (!name) { live = await renderScores(first, token); poll = LIVE_POLL; }
    else if (name === 'mine') { live = await renderMine(first, token); poll = LIVE_POLL; }
    else if (name === 'follow') { live = await renderFollow(first, token); poll = 0; }
    else if (name === 'team' && safe(a) && safe(b)) {
      const slug = query.get('l');
      live = await renderTeam(first, token, a === 'cricket' ? 'cricket' : 'soccer', b, safe(slug) ? slug : '');
      poll = LIVE_POLL;
    } else if (name === 'm' && safe(a) && safe(b) && safe(c)) {
      live = await renderMatch(first, token, a === 'cricket' ? 'cricket' : 'soccer', b, c);
      poll = MATCH_POLL;
    } else if (name === 'p' && safe(a) && safe(b)) {
      live = await renderPlayer(first, token, a === 'cricket' ? 'cricket' : 'soccer', b);
      poll = 0;
    } else { location.hash = '#/'; return; }
    if (token !== routeToken) return;
    stamp();
  } catch (err) {
    if (token !== routeToken) return;
    if (first) setHTML(view, '<div class="empty">Could not load this. Check your connection and try again.<br><br><button class="btn ghost" data-act="retry">Try again</button></div>');
    else toast('Could not refresh. Trying again soon.');
    live = false;
  }
  if (poll && !document.hidden) pollTimer = setTimeout(() => run(false), live ? poll : Math.max(poll, IDLE_POLL));
}
function go() { routeToken += 1; run(true); }
function again() { routeToken += 1; return run(false); }

/* ---------- Events ---------- */
window.addEventListener('hashchange', go);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) clearTimeout(pollTimer);
  else again();
});
document.addEventListener('error', (e) => {
  if (e.target.tagName === 'IMG') e.target.style.visibility = 'hidden';
}, true);
$('refresh').addEventListener('click', () => { try { localStorage.removeItem('matchday.scan'); } catch { /* ignore */ } again(); });
$('back').addEventListener('click', () => { if (history.length > 1) history.back(); else location.hash = '#/'; });

document.addEventListener('input', (e) => {
  if (e.target.id !== 'followSearch') return;
  followQuery = e.target.value.trim();
  clearTimeout(e.target._t);
  e.target._t = setTimeout(() => renderFollowBody(routeToken), 200);
});

document.addEventListener('click', (e) => {
  const el = e.target.closest('button');
  if (!el) return;
  const d = el.dataset;
  if (d.day !== undefined) { scoreDay = Number(d.day); go(); }
  else if (d.sport) { state.sport = d.sport; save(); go(); }
  else if (d.ftab) { followTab = d.ftab; go(); }
  else if (d.ttab) { teamTab = d.ttab; again(); }
  else if (d.mtab) { matchTab = d.mtab; again(); }
  else if (d.tf) { timelineFilter = d.tf; again(); }
  else if (d.inn) { chosenInnings = Number(d.inn); again(); }
  else if (d.act === 'retry') go();
  else if (d.act === 'all-cricket') { state.allCricket = !state.allCricket; save(); again(); }
  else if (d.open) {
    if (openLeagues.has(d.open)) openLeagues.delete(d.open); else openLeagues.add(d.open);
    renderFollowBody(routeToken);
  } else if (d.league) {
    state.leagues = state.leagues.includes(d.league) ? state.leagues.filter((s) => s !== d.league) : [...state.leagues, d.league];
    save(); renderFollowBody(routeToken);
  } else if (d.series) {
    state.series = state.series.some((s) => s.id === d.series) ? state.series.filter((s) => s.id !== d.series) : [...state.series, { id: d.series, name: d.name }];
    state.allCricket = false;
    save(); renderFollowBody(routeToken);
  } else if (d.star) {
    toggleTeam(JSON.parse(d.star));
    if (location.hash.startsWith('#/follow')) renderFollowBody(routeToken); else again();
  }
});

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
go();
