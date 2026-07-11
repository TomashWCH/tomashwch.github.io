// Wysyła powiadomienia push (OneSignal) dla obu apek Liga Typera.
// Uruchamiane cyklicznie przez GitHub Actions (.github/workflows/push-notify.yml).
// Klucze i sekrety pochodzą WYŁĄCZNIE ze zmiennych środowiskowych (GitHub Secrets) — nigdy z kodu HTML.

import { GoogleAuth } from 'google-auth-library';

const REMIND_MINUTES = Number(process.env.REMIND_MINUTES || 60);
const FB_SCOPES = [
  'https://www.googleapis.com/auth/firebase.database',
  'https://www.googleapis.com/auth/userinfo.email',
];

const TEAMS = {
 ARG:"Argentyna",FRA:"Francja",ESP:"Hiszpania",BRA:"Brazylia",ENG:"Anglia",POR:"Portugalia",
 ITA:"Włochy",NED:"Holandia",GER:"Niemcy",BEL:"Belgia",URU:"Urugwaj",CRO:"Chorwacja",
 COL:"Kolumbia",MAR:"Maroko",SUI:"Szwajcaria",NOR:"Norwegia",ECU:"Ekwador",DEN:"Dania",TUR:"Turcja",
 JPN:"Japonia",SEN:"Senegal",IRN:"Iran",AUT:"Austria",MEX:"Meksyk",KOR:"Korea Płd.",
 USA:"USA",SWE:"Szwecja",CAN:"Kanada",NGA:"Nigeria",UKR:"Ukraina",DZA:"Algieria",
 EGY:"Egipt",AUS:"Australia",PAR:"Paragwaj",POL:"Polska",CIV:"Wyb. K. Słon.",COD:"DR Konga",
 GHA:"Ghana",BIH:"Bośnia i Herc.",TUN:"Tunezja",UZB:"Uzbekistan",
 KSA:"Arabia Saud.",RSA:"RPA",IRQ:"Irak",PAN:"Panama",JOR:"Jordania",QAT:"Katar",
 CPV:"Zielony Przyl.",NZL:"Nowa Zelandia",CZE:"Czechy",HAI:"Haiti",SCO:"Szkocja",CUW:"Curacao"
};
const teamName = c => TEAMS[c] || c;

// App ID wpisane NA SZTYWNO — identyczne jak w plikach HTML (są jawne z natury).
// Dzięki temu nie mogą się rozjechać z aplikacją. Tajne pozostają tylko klucze REST.
const APPS = [
  {
    label: 'P258',
    dbUrl: process.env.FIREBASE_DB_URL_P258,
    serviceAccountJson: process.env.FIREBASE_SERVICE_ACCOUNT_P258,
    oneSignalAppId: '6f33addf-12e1-48a0-81f9-8afd37127133',
    oneSignalRestKey: process.env.ONESIGNAL_REST_KEY_P258,
  },
  {
    label: 'JYSK',
    dbUrl: process.env.FIREBASE_DB_URL_JYSK,
    serviceAccountJson: process.env.FIREBASE_SERVICE_ACCOUNT_JYSK,
    oneSignalAppId: 'b71033e4-8af0-4305-bf76-96da9d26d6c2',
    oneSignalRestKey: process.env.ONESIGNAL_REST_KEY_JYSK,
  },
];

async function getAccessToken(serviceAccountJson) {
  const credentials = JSON.parse(serviceAccountJson);
  const auth = new GoogleAuth({ credentials, scopes: FB_SCOPES });
  const client = await auth.getClient();
  const { token } = await client.getAccessToken();
  return token;
}

// Nowe apki OneSignal (2024+) nie mają segmentu "Subscribed Users" — domyślny nazywa się "Total Subscriptions".
// Wysyłka do nieistniejącego segmentu zwraca mylące "All included players are not subscribed",
// dlatego próbujemy obu nazw po kolei.
const SEGMENT_CANDIDATES = [['Total Subscriptions'], ['Subscribed Users']];
async function sendPush(appId, restKey, title, message) {
  const auth = restKey.startsWith('os_v2') ? `Key ${restKey}` : `Basic ${restKey}`;
  let lastErr = '';
  for (const segments of SEGMENT_CANDIDATES) {
    const res = await fetch('https://onesignal.com/api/v1/notifications', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Authorization': auth,
      },
      body: JSON.stringify({
        app_id: appId,
        target_channel: 'push',
        included_segments: segments,
        headings: { pl: title, en: title },
        contents: { pl: message, en: message },
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && !data.errors && data.id) {
      note(`Push sent ✅ (segment: ${segments[0]}) ${title} | id: ${String(data.id).slice(0, 12)}…`);
      return true;
    }
    lastErr = res.status + ' ' + JSON.stringify(data).slice(0, 180);
  }
  noteErr('OneSignal send failed (próbowałem obu nazw segmentów): ' + lastErr);
  return false;
}

async function sendPushToPlayers(appId, restKey, title, message, pids) {
  if (!pids || !pids.length) return true;
  const auth = restKey.startsWith('os_v2') ? `Key ${restKey}` : `Basic ${restKey}`;
  const res = await fetch('https://onesignal.com/api/v1/notifications', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Authorization': auth },
    body: JSON.stringify({
      app_id: appId,
      target_channel: 'push',
      include_aliases: { external_id: pids.map(String) },
      headings: { pl: title, en: title },
      contents: { pl: message, en: message },
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (res.ok && !data.errors && data.id) {
    note(`Push celowany ✅ (${pids.length} odb.) ${title} | id: ${String(data.id).slice(0, 12)}…`);
    return true;
  }
  // "not subscribed" przy celowanych = adresaci nie mają jeszcze dzwoneczka/loginu — nie blokujemy kolejki
  note(`Push celowany: brak aktywnych odbiorców wśród wskazanych (${pids.length}) — pomijam. ${JSON.stringify(data).slice(0,120)}`);
  return true;
}

async function fbGet(dbUrl, path, token) {
  const url = `${dbUrl}/${path}.json`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Firebase GET ${path} failed: ${res.status}`);
  return res.json();
}

async function fbPost(dbUrl, path, token, body) {
  const url = `${dbUrl}/${path}.json`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Firebase POST ${path} failed: ${res.status}`);
  return res.json();
}

async function fbPatch(dbUrl, path, token, body) {
  const url = `${dbUrl}/${path}.json`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Firebase PATCH ${path} failed: ${res.status}`);
}

async function fbDelete(dbUrl, path, token) {
  const url = `${dbUrl}/${path}.json`;
  const res = await fetch(url, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Firebase DELETE ${path} failed: ${res.status}`);
}

const REPORT = [];
function note(s){ REPORT.push(s); console.log(s); }
function noteErr(s){ REPORT.push('❗ '+s); console.error(s); }

async function preflightOneSignal(app) {
  // Diagnostyka: do KTÓREJ apki OneSignal celują sekrety i ilu ma subskrybentów.
  try {
    const auth = app.oneSignalRestKey.startsWith('os_v2') ? `Key ${app.oneSignalRestKey}` : `Basic ${app.oneSignalRestKey}`;
    const res = await fetch(`https://onesignal.com/api/v1/players?app_id=${app.oneSignalAppId}&limit=1`, { headers: { Authorization: auth } });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) {
      noteErr(`PREFLIGHT: OneSignal odrzucił parę AppID+klucz (HTTP ${res.status}) — REST key nie pasuje do tej apki albo jest nieważny. ${JSON.stringify(d).slice(0, 150)}`);
      return false;
    }
    note(`PREFLIGHT: apka ${String(app.oneSignalAppId).slice(0, 8)}… | subskrypcji: ${d.total_count}`);
    if (!d.total_count) {
      noteErr(`Ta apka OneSignal ma ZERO subskrybentów widocznych dla API — kliknij dzwoneczek 🔔 w apce na telefonie i sprawdź Audience w OneSignal.`);
    }
    return true;
  } catch (e) {
    console.error(`[${app.label}] PREFLIGHT padł:`, e.message);
    return false;
  }
}

/* ================= AUTOMATYCZNE WYNIKI (openfootball, domena publiczna) ================= */
const RESULTS_SOURCE = 'https://raw.githubusercontent.com/openfootball/worldcup.json/master/2026/worldcup.json';
const API_TEAM = {'Algeria':'DZA','Argentina':'ARG','Australia':'AUS','Austria':'AUT','Belgium':'BEL','Bosnia & Herzegovina':'BIH','Brazil':'BRA','Canada':'CAN','Cape Verde':'CPV','Colombia':'COL','Croatia':'CRO','Curaçao':'CUW','Czech Republic':'CZE','DR Congo':'COD','Ecuador':'ECU','Egypt':'EGY','England':'ENG','France':'FRA','Germany':'GER','Ghana':'GHA','Haiti':'HAI','Iran':'IRN','Iraq':'IRQ','Ivory Coast':'CIV','Japan':'JPN','Jordan':'JOR','Mexico':'MEX','Morocco':'MAR','Netherlands':'NED','New Zealand':'NZL','Norway':'NOR','Panama':'PAN','Paraguay':'PAR','Portugal':'POR','Qatar':'QAT','Saudi Arabia':'KSA','Scotland':'SCO','Senegal':'SEN','South Africa':'RSA','South Korea':'KOR','Spain':'ESP','Sweden':'SWE','Switzerland':'SUI','Tunisia':'TUN','Turkey':'TUR','USA':'USA','Uruguay':'URU','Uzbekistan':'UZB'};
let SOURCE_CACHE = null; // jedno pobranie na przebieg, wspólne dla obu lig

async function autoEnterResults(app, token) {
  const cfg = await fbGet(app.dbUrl, 'config/autoResults', token);
  if (cfg !== true) { return; } // wyłączone przełącznikiem w ustawieniach admina
  if (SOURCE_CACHE === null) {
    try {
      const r = await fetch(RESULTS_SOURCE + '?t=' + Math.floor(Date.now() / 300000));
      if (!r.ok) throw new Error('HTTP ' + r.status);
      SOURCE_CACHE = (await r.json()).matches || [];
    } catch (e) { noteErr('Auto-wyniki: źródło openfootball niedostępne (' + e.message + ') — spróbuję za 5 min.'); SOURCE_CACHE = []; return; }
  }
  if (!SOURCE_CACHE.length) return;
  const matches = await fbGet(app.dbUrl, 'matches', token);
  if (!matches) return;
  const now = Date.now();
  const used = new Set();
  let entered = 0;
  for (const am of SOURCE_CACHE) {
    const sc = am.score; if (!sc || !sc.ft) continue;
    const h = API_TEAM[am.team1], a = API_TEAM[am.team2];
    if (!h || !a) continue;
    const cand = Object.entries(matches).find(([id, mm]) =>
      mm && !mm.done && !used.has(id) && mm.kickoff && (mm.kickoff + 150 * 60000) < now &&
      ((mm.home === h && mm.away === a) || (mm.home === a && mm.away === h)));
    if (!cand) continue;
    const [mid, mm] = cand; used.add(mid);
    const sw = mm.home === a;
    const pick = arr => arr ? (sw ? [Number(arr[1]), Number(arr[0])] : [Number(arr[0]), Number(arr[1])]) : null;
    const ft = pick(sc.ft), et = pick(sc.et), p = pick(sc.p);
    const ko = (mm.stage || '') !== 'Faza grupowa';
    let adv = null;
    if (ko && ft[0] === ft[1]) {
      if (p && p[0] !== p[1]) adv = p[0] > p[1] ? 'home' : 'away';
      else if (et && et[0] !== et[1]) adv = et[0] > et[1] ? 'home' : 'away';
    }
    await fbPatch(app.dbUrl, `matches/${mid}`, token, {
      hs: ft[0], as: ft[1], done: true, rts: Date.now(),
      fhs: ko && et ? et[0] : null, fas: ko && et ? et[1] : null,
      ph: ko && p ? p[0] : null, pa: ko && p ? p[1] : null,
      adv, pens: null, aet: null, pen: null,
    });
    // zlecenie w kolejce — ten sam przebieg wyśle push o wyniku i gratulacje za trafienia
    await fbPost(app.dbUrl, 'notify/pending', token, { type: 'result', mid, home: mm.home, away: mm.away, hs: ft[0], as: ft[1], ts: Date.now() });
    note(`🤖 Auto-wynik: ${mm.home} ${ft[0]}:${ft[1]} ${mm.away}${et ? ' (d ' + et[0] + ':' + et[1] + ')' : ''}${p ? ' (k ' + p[0] + ':' + p[1] + ')' : ''}`);
    entered++;
    matches[mid] = Object.assign({}, mm, { hs: ft[0], as: ft[1], done: true });
  }
  if (entered) await maybeChatReports(app, token, matches);
}

// Raport rundy na czacie (ta sama logika co bot w apce: Kicktipp w obrębie etapu, joker ×2)
async function maybeChatReports(app, token, matches) {
  const stages = {};
  for (const m of Object.values(matches)) { const k = (m && m.stage) || 'Mecz'; (stages[k] = stages[k] || []).push(m); }
  const doneStages = Object.entries(stages).filter(([, ms]) => ms.length && ms.every(m => m.done)).map(([st]) => st);
  if (!doneStages.length) return;
  const sent = (await fbGet(app.dbUrl, 'meta/botSent', token)) || {};
  const PART = (await fbGet(app.dbUrl, 'participants', token)) || {};
  const PRED = (await fbGet(app.dbUrl, 'predictions', token)) || {};
  const midOf = {}; Object.entries(matches).forEach(([id, m]) => { midOf[id] = m; });
  for (const st of doneStages) {
    const key = 'r_' + st.replace(/[.#$/\[\]]/g, '_');
    if (sent[key]) continue;
    const ms = Object.entries(matches).filter(([, m]) => ((m.stage || 'Mecz') === st && m.done));
    const scpl = {}; let exTotal = 0;
    for (const [mid, m] of ms) {
      for (const [pid, pr] of Object.entries(PRED[mid] || {})) {
        if (!PART[pid] || !pr) continue;
        const mult = pr.j ? 2 : 1;
        const ph2 = Number(pr.h), pa2 = Number(pr.a), hs2 = Number(m.hs), as2 = Number(m.as);
        scpl[pid] = scpl[pid] || { pts: 0, exact: 0 };
        if (ph2 === hs2 && pa2 === as2) { scpl[pid].pts += 3 * mult; scpl[pid].exact++; exTotal++; }
        else if (Math.sign(ph2 - pa2) === Math.sign(hs2 - as2)) scpl[pid].pts += 1 * mult;
      }
    }
    const arr = Object.entries(scpl).sort((x, y) => y[1].pts - x[1].pts || y[1].exact - x[1].exact);
    const nMecz = ms.length === 1 ? 'mecz' : ((ms.length % 10 >= 2 && ms.length % 10 <= 4 && (ms.length % 100 < 12 || ms.length % 100 > 14)) ? 'mecze' : 'meczów');
    let out = '📋 RAPORT · ' + st.toUpperCase() + ' · ' + ms.length + ' ' + nMecz + ' rozegrane';
    if (arr.length && arr[0][1].pts > 0) {
      const best = arr[0][1];
      const top = arr.filter(([, v]) => v.pts === best.pts && v.exact === best.exact).map(([pid]) => PART[pid].name);
      out += '\n🥇 MVP rundy: ' + top.join(', ') + ' — ' + best.pts + ' pkt Kicktipp (' + best.exact + ' dokładn' + (best.exact === 1 ? 'e' : 'ych') + ')';
    } else out += '\n🙈 Nikt nie zapunktował w tej rundzie…';
    out += '\n🎯 Dokładne trafienia w rundzie: ' + exTotal;
    const totals = Object.entries(PART).map(([pid, p]) => {
      let c = 0;
      for (const [mid, m] of Object.entries(matches)) {
        if (!m || !m.done) continue;
        const pr = PRED[mid] && PRED[mid][pid];
        if (pr && Number(pr.h) === Number(m.hs) && Number(pr.a) === Number(m.as)) c += (pr.j ? 2 : 1);
      }
      return { name: p.name, total: Number(p.start || 0) + c };
    }).sort((x, y) => y.total - x.total);
    if (totals.length) {
      const lead = totals.filter(t => t.total === totals[0].total).map(t => t.name);
      out += '\n👑 Prowadzi: ' + lead.join(', ') + ' (' + totals[0].total + ' pkt)';
    }
    await fbPatch(app.dbUrl, 'meta/botSent', token, { [key]: true });
    await fbPost(app.dbUrl, 'chat', token, { pid: '__bot__', name: '⚽ Liga Bot', text: out.slice(0, 900), ts: Date.now() });
    note('🤖 Raport rundy „' + st + '" wrzucony na czat.');
  }
}

async function processApp(app) {
  if (!app.dbUrl || !app.serviceAccountJson || !app.oneSignalAppId || !app.oneSignalRestKey) {
    console.log(`[${app.label}] pominięto — brak kompletu sekretów (jeszcze nieskonfigurowane).`);
    return;
  }
  console.log(`[${app.label}] sprawdzam...`);
  await preflightOneSignal(app);

  let token;
  try {
    token = await getAccessToken(app.serviceAccountJson);
  } catch (e) {
    console.error(`[${app.label}] nie udało się uzyskać tokenu dostępu:`, e.message);
    return;
  }

  // 0) Automatyczne wpisywanie wyników (jeśli włączone w ustawieniach ligi)
  try { await autoEnterResults(app, token); }
  catch (e) { noteErr('Auto-wyniki: ' + e.message); }

  // 1) Zlecenia od admina (np. zapisany wynik meczu)
  try {
    const pending = await fbGet(app.dbUrl, 'notify/pending', token);
    if (pending) {
      for (const [key, item] of Object.entries(pending)) {
        let ok = true;
        if (item.type === 'test') {
          ok = await sendPush(app.oneSignalAppId, app.oneSignalRestKey,
            '🧪 Test powiadomień', 'Działa! Liga Typera może wysyłać pushe. 🎉');
        }
        else if (item.type === 'result') {
          const title = `⚽ ${teamName(item.home)} ${item.hs} : ${item.as} ${teamName(item.away)}`;
          const message = 'Koniec meczu — sprawdź swój typ i tabelę w Lidze Typera!';
          ok = await sendPush(app.oneSignalAppId, app.oneSignalRestKey, title, message);
          // 🎯 gratulacje tylko dla tych, którzy trafili dokładny wynik
          if (ok && item.mid != null) {
            try {
              const preds = await fbGet(app.dbUrl, `predictions/${item.mid}`, token);
              if (preds) {
                const exact = Object.entries(preds).filter(([pid, pr]) =>
                  pr && Number(pr.h) === Number(item.hs) && Number(pr.a) === Number(item.as));
                const zwykli = exact.filter(([, pr]) => !pr.j).map(([pid]) => pid);
                const jokerzy = exact.filter(([, pr]) => pr.j).map(([pid]) => pid);
                if (zwykli.length) await sendPushToPlayers(app.oneSignalAppId, app.oneSignalRestKey,
                  '🎯 Dokładne trafienie!', `Wytypowałeś ${item.hs}:${item.as} w meczu ${teamName(item.home)} – ${teamName(item.away)}. Brawo!`, zwykli);
                if (jokerzy.length) await sendPushToPlayers(app.oneSignalAppId, app.oneSignalRestKey,
                  '🎯⭐ Dokładne trafienie z JOKEREM!', `Wytypowałeś ${item.hs}:${item.as} w meczu ${teamName(item.home)} – ${teamName(item.away)} — punkty ×2. Mistrzostwo!`, jokerzy);
              }
            } catch (e) { noteErr('Gratulacje za trafienia nie wyszły: ' + e.message); }
          }
        }
        if (ok) { await fbDelete(app.dbUrl, `notify/pending/${key}`, token); note(`Wysłano push (${item.type}) i usunięto zlecenie ${key}.`); }
        else noteErr(`Zlecenie ${key} (${item.type}) NIE wysłane — zostaje w kolejce do ponowienia.`);
      }
    }
  } catch (e) {
    console.error(`[${app.label}] błąd przy notify/pending:`, e.message);
  }

  // 2) Przypomnienia przed zbliżającymi się meczami — tylko do graczy BEZ typu
  try {
    const matches = await fbGet(app.dbUrl, 'matches', token);
    if (matches) {
      const now = Date.now();
      let participants = null;
      for (const [mid, m] of Object.entries(matches)) {
        if (!m || m.done || m.remindSent || !m.kickoff) continue;
        const msLeft = m.kickoff - now;
        if (msLeft > 0 && msLeft <= REMIND_MINUTES * 60000) {
          if (!participants) participants = (await fbGet(app.dbUrl, 'participants', token)) || {};
          const preds = (await fbGet(app.dbUrl, `predictions/${mid}`, token)) || {};
          const missing = Object.keys(participants).filter(pid => !preds[pid]);
          const mins = Math.round(msLeft / 60000);
          let ok = true;
          if (missing.length) {
            ok = await sendPushToPlayers(app.oneSignalAppId, app.oneSignalRestKey,
              '⏰ Nie masz typu!', `${teamName(m.home)} – ${teamName(m.away)} zaczyna się za ${mins} min. Zdąż obstawić!`, missing);
            if (ok) note(`Przypomnienie ${m.home}-${m.away}: wysłane do ${missing.length} graczy bez typu.`);
          } else {
            note(`Przypomnienie ${m.home}-${m.away}: wszyscy mają typy — nikogo nie budzę. 👏`);
          }
          if (ok) await fbPatch(app.dbUrl, `matches/${mid}`, token, { remindSent: true });
          else noteErr(`Przypomnienie o ${m.home}-${m.away} NIE wysłane — ponowię.`);
        }
      }
    }
  } catch (e) {
    noteErr(`Błąd przy przypomnieniach: ` + e.message);
  }

  // 3) Raport z przebiegu do bazy — apka pokaże go w karcie diagnostycznej
  try {
    const text = REPORT.length ? REPORT.join('\n') : 'Przebieg OK — nic do wysłania (brak zleceń i meczów w oknie przypomnień).';
    await fbPatch(app.dbUrl, 'notify/lastRun', token, { ts: Date.now(), report: text.slice(0, 4000) });
    REPORT.length = 0;
  } catch (e) {
    console.error(`[${app.label}] nie zapisałem raportu:`, e.message);
  }
}

for (const app of APPS) {
  await processApp(app);
}

