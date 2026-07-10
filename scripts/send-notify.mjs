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

const APPS = [
  {
    label: 'P258',
    dbUrl: process.env.FIREBASE_DB_URL_P258,
    serviceAccountJson: process.env.FIREBASE_SERVICE_ACCOUNT_P258,
    oneSignalAppId: process.env.ONESIGNAL_APP_ID_P258,
    oneSignalRestKey: process.env.ONESIGNAL_REST_KEY_P258,
  },
  {
    label: 'JYSK',
    dbUrl: process.env.FIREBASE_DB_URL_JYSK,
    serviceAccountJson: process.env.FIREBASE_SERVICE_ACCOUNT_JYSK,
    oneSignalAppId: process.env.ONESIGNAL_APP_ID_JYSK,
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

async function sendPush(appId, restKey, title, message) {
  const auth = restKey.startsWith('os_v2') ? `Key ${restKey}` : `Basic ${restKey}`;
  const res = await fetch('https://onesignal.com/api/v1/notifications', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Authorization': auth,
    },
    body: JSON.stringify({
      app_id: appId,
      target_channel: 'push',
      included_segments: ['Subscribed Users'],
      headings: { pl: title, en: title },
      contents: { pl: message, en: message },
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.errors) {
    console.error('OneSignal send failed:', res.status, JSON.stringify(data));
    return false;
  }
  console.log('Push sent:', title, '-', message, '| id:', data.id);
  return true;
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

async function processApp(app) {
  if (!app.dbUrl || !app.serviceAccountJson || !app.oneSignalAppId || !app.oneSignalRestKey) {
    console.log(`[${app.label}] pominięto — brak kompletu sekretów (jeszcze nieskonfigurowane).`);
    return;
  }
  console.log(`[${app.label}] sprawdzam...`);

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
        if (ok) await fbDelete(app.dbUrl, `notify/pending/${key}`, token);
        else console.error(`[${app.label}] zlecenie ${key} zostaje w kolejce — ponowię przy następnym przebiegu.`);
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
          if (ok) await fbPatch(app.dbUrl, `matches/${mid}`, token, { remindSent: true });
          else console.error(`[${app.label}] przypomnienie o ${m.home}-${m.away} NIE wysłane — spróbuję przy następnym przebiegu.`);
        }
      }
    }
  } catch (e) {
    console.error(`[${app.label}] błąd przy przypomnieniach:`, e.message);
  }
}

for (const app of APPS) {
  await processApp(app);
}

