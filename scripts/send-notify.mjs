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

async function fbGet(dbUrl, path, token) {
  const url = `${dbUrl}/${path}.json`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Firebase GET ${path} failed: ${res.status}`);
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

  // 1) Zlecenia od admina (np. zapisany wynik meczu)
  try {
    const pending = await fbGet(app.dbUrl, 'notify/pending', token);
    if (pending) {
      for (const [key, item] of Object.entries(pending)) {
        let ok = true;
        if (item.type === 'test') {
          ok = await sendPush(app.oneSignalAppId, app.oneSignalRestKey,
            '🧪 Test powiadomień', `Działa! Liga Typera ${app.label} może wysyłać pushe. 🎉`);
        }
        else if (item.type === 'result') {
          const title = `⚽ Wynik: ${teamName(item.home)} ${item.hs}:${item.as} ${teamName(item.away)}`;
          const message = `Sprawdź swój typ i tabelę w Lidze Typera ${app.label}!`;
          ok = await sendPush(app.oneSignalAppId, app.oneSignalRestKey, title, message);
        }
        if (ok) { await fbDelete(app.dbUrl, `notify/pending/${key}`, token); note(`Wysłano push (${item.type}) i usunięto zlecenie ${key}.`); }
        else noteErr(`Zlecenie ${key} (${item.type}) NIE wysłane — zostaje w kolejce do ponowienia.`);
      }
    }
  } catch (e) {
    console.error(`[${app.label}] błąd przy notify/pending:`, e.message);
  }

  // 2) Przypomnienia przed zbliżającymi się meczami
  try {
    const matches = await fbGet(app.dbUrl, 'matches', token);
    if (matches) {
      const now = Date.now();
      for (const [mid, m] of Object.entries(matches)) {
        if (!m || m.done || m.remindSent || !m.kickoff) continue;
        const msLeft = m.kickoff - now;
        if (msLeft > 0 && msLeft <= REMIND_MINUTES * 60000) {
          const title = `⏰ Zbliża się mecz!`;
          const message = `${teamName(m.home)} – ${teamName(m.away)} już za ${Math.round(msLeft / 60000)} min. Zdąż wytypować wynik!`;
          const ok = await sendPush(app.oneSignalAppId, app.oneSignalRestKey, title, message);
          if (ok) { await fbPatch(app.dbUrl, `matches/${mid}`, token, { remindSent: true }); note(`Wysłano przypomnienie: ${m.home}-${m.away}.`); }
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

