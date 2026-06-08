import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// Complete airport list including global airports for non-EU carrier routes
const ALL_AIRPORTS = new Set([
  // Spain
  "MAD","BCN","AGP","PMI","ALC","VLC","SVQ","BIO","TFS","LPA","ACE","FUE","IBZ","MAH","SDR","SCQ","VGO","OVD","ZAZ","GRX","MJV","XRY","LEI","REU","GRO","PNA","RZE",
  // UK
  "LHR","LGW","STN","LTN","MAN","EDI","BHX","GLA","BRS","NCL","LPL","ABZ","BFS","EMA","CWL",
  // Netherlands / Belgium
  "AMS","EIN","RTM","BRU","LGG",
  // France
  "CDG","ORY","LYS","NCE","MRS","TLS","BOD","NTE","MPL","BSL",
  // Germany
  "FRA","MUC","BER","DUS","HAM","STR","CGN","NUE","LEJ","HAJ",
  // Italy
  "FCO","MXP","LIN","VCE","NAP","BLQ","PMO","CTA","CAG","BRI","TRN","VRN","PSA","FLR",
  // Portugal
  "LIS","OPO","FAO",
  // Scandinavia
  "CPH","ARN","GOT","OSL","BGO","TRD","HEL","RIX","TLL","VNO",
  // Eastern Europe
  "WAW","KRK","PRG","BUD","OTP","SOF","BEG","ZAG","LJU","SKP","TIA",
  // Greece / Cyprus
  "ATH","SKG","HER","RHO","CFU","KGS","LCA","PFO",
  // Ireland
  "DUB","ORK","SNN",
  // Turkey
  "IST","SAW","AYT","ADB","ESB","ADA",
  // Middle East / Gulf
  "DXB","AUH","DOH","AMM","BEY","CAI","TLV",
  // USA
  "JFK","EWR","LGA","LAX","ORD","ATL","DFW","MIA","BOS","SFO","SEA","DEN","IAD","IAH","PHX",
  // Asia
  "PEK","PVG","HKG","SIN","BKK","NRT","ICN","KUL","CGK","MNL","DEL","BOM","DPS",
  // Other
  "YYZ","YVR","MEX","GRU","EZE","SCL","LIM","BOG","NBO","JNB","CPT","SYD","MEL",
]);

const AIRLINE_NAMES: Record<string, string> = {
  "FR": "Ryanair", "U2": "easyJet", "W6": "Wizz Air", "VY": "Vueling",
  "KL": "KLM", "AF": "Air France", "LH": "Lufthansa", "IB": "Iberia",
  "BA": "British Airways", "HV": "Transavia", "DY": "Norwegian",
  "TP": "TAP Air Portugal", "TK": "Turkish Airlines", "EK": "Emirates",
  "UX": "Air Europa", "UA": "United Airlines", "DL": "Delta",
  "AA": "American Airlines", "QR": "Qatar Airways", "EY": "Etihad",
  "SK": "SAS", "AY": "Finnair", "LO": "LOT Polish", "A3": "Aegean",
  "LX": "SWISS", "OS": "Austrian", "SN": "Brussels Airlines",
  "BT": "airBaltic", "PS": "Ukraine Intl", "RO": "TAROM",
  "AZ": "ITA Airways", "EN": "Air Dolomiti", "WF": "Wideroe",
};

const AIRLINE_DOMAINS = [
  "ryanair.com", "easyjet.com", "wizzair.com", "vueling.com",
  "klm.com", "airfrance.com", "lufthansa.com", "iberia.com",
  "britishairways.com", "transavia.com", "norwegian.com", "tap.pt",
  "turkishairlines.com", "emirates.com", "aireuropa.com",
  "united.com", "delta.com", "aa.com", "qatarairways.com",
  "etihad.com", "flysas.com", "finnair.com", "lot.com",
  "swiss.com", "austrian.com", "brusselsairlines.com",
  "airbaltic.com", "flydubai.com", "easyjet.com", "condor.com",
  "tui.com", "corendon.com", "sunexpress.com",
  // Booking platforms also send flight confirmations
  "booking.com", "expedia.com", "kayak.com", "skyscanner.com",
  "edreams.com", "opodo.com", "lastminute.com", "kiwi.com",
  "bravofly.com", "trip.com", "google.com",
];

const BOOKING_KEYWORDS = [
  "booking confirmation", "your booking", "your flight",
  "itinerary", "boarding pass", "e-ticket", "order confirmation",
  "flight details", "reservation", "your reservation",
  "travel confirmation", "flight confirmation", "booked",
];

function buildGmailQuery(): string {
  const domainQuery = AIRLINE_DOMAINS.map(d => `from:${d}`).join(" OR ");
  const keywordQuery = BOOKING_KEYWORDS.slice(0, 8).map(k => `"${k}"`).join(" OR ");
  return `(${domainQuery}) (${keywordQuery}) newer_than:1095d`;
}

function extractFlightNumber(text: string): string | null {
  // Match airline code (2 letters) + flight number (3-4 digits)
  // Exclude common false positives like EU261, A320, B737 etc
  const matches = text.matchAll(/\b([A-Z]{2})(\d{3,4})\b/g);
  for (const m of matches) {
    const code = m[1];
    // Must be a known airline code
    if (AIRLINE_NAMES[code]) return m[0];
  }
  return null;
}

function extractAirports(text: string): { dep: string | null; arr: string | null } {
  // Look for patterns like "MAD → AMS" or "MAD - AMS" or "MAD to AMS"
  const routeMatch = text.match(/\b([A-Z]{3})\s*(?:→|->|–|-|to)\s*([A-Z]{3})\b/);
  if (routeMatch) {
    const dep = routeMatch[1];
    const arr = routeMatch[2];
    if (ALL_AIRPORTS.has(dep) && ALL_AIRPORTS.has(arr)) {
      return { dep, arr };
    }
  }

  // Fallback: find any IATA codes in order
  const codes = [...text.matchAll(/\b([A-Z]{3})\b/g)]
    .map(m => m[1])
    .filter(c => ALL_AIRPORTS.has(c));

  // Deduplicate while preserving order
  const unique = [...new Set(codes)];
  return { dep: unique[0] ?? null, arr: unique[1] ?? null };
}

function extractDate(text: string, fallback: string): string {
  // Try various date formats
  const patterns = [
    /(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(202\d)/i,
    /(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(202\d)/i,
    /(202\d)[-\/](\d{2})[-\/](\d{2})/,
    /(\d{2})[-\/](\d{2})[-\/](202\d)/,
    /(\d{1,2})[-\/](\d{1,2})[-\/](202\d)/,
  ];

  for (const re of patterns) {
    const m = text.match(re);
    if (m) {
      const parsed = new Date(m[0]);
      if (!isNaN(parsed.getTime()) && parsed.getFullYear() >= 2022) {
        return parsed.toISOString().split("T")[0];
      }
    }
  }

  // Use email date as fallback
  const parsed = new Date(fallback);
  if (!isNaN(parsed.getTime())) return parsed.toISOString().split("T")[0];
  return new Date().toISOString().split("T")[0];
}

async function fetchFullEmailText(msgId: string, token: string): Promise<string> {
  const res = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msgId}?format=full`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) return "";
  const data = await res.json();

  function extractParts(payload: any): string {
    let text = "";
    if (payload?.body?.data) {
      try {
        text += atob(payload.body.data.replace(/-/g, "+").replace(/_/g, "/"));
      } catch { /* ignore decode errors */ }
    }
    if (payload?.parts) {
      for (const part of payload.parts) {
        if (part.mimeType === "text/plain" || part.mimeType === "text/html") {
          text += extractParts(part);
        } else if (part.parts) {
          text += extractParts(part);
        }
      }
    }
    return text;
  }

  const subject = (data.payload?.headers ?? []).find((h: any) => h.name === "Subject")?.value ?? "";
  const body = extractParts(data.payload);
  return (subject + " " + body).substring(0, 5000);
}

export const scanGmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;

    // Get stored Gmail token
    const { data: profileData } = await (supabase as any)
      .from("profiles")
      .select("gmail_access_token")
      .eq("id", userId)
      .single();

    const googleToken = profileData?.gmail_access_token;
    if (!googleToken) {
      return { detected: 0, inserted: 0, error: "No Gmail token — please reconnect" };
    }

    // Build query and fetch message list
    const query = encodeURIComponent(buildGmailQuery());
    const listRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${query}&maxResults=100`,
      { headers: { Authorization: `Bearer ${googleToken}` } }
    );

    if (!listRes.ok) {
      const err = await listRes.text();
      console.error("Gmail list error:", err);
      if (listRes.status === 401) {
        return { detected: 0, inserted: 0, error: "Gmail token expired — please sign out and back in" };
      }
      return { detected: 0, inserted: 0, error: `Gmail API error: ${listRes.status}` };
    }

    const listData = await listRes.json();
    const messages: any[] = listData.messages ?? [];

    if (messages.length === 0) {
      return { detected: 0, inserted: 0, error: "No matching emails found" };
    }

    // Get existing flights to avoid duplicates
    const { data: existing } = await (supabase as any)
      .from("flights")
      .select("flight_number, departure_date")
      .eq("user_id", userId);

    const seen = new Set(
      (existing ?? []).map((f: any) => `${f.flight_number}-${f.departure_date}`)
    );

    const toInsert: any[] = [];

    // Process emails in batches
    for (const msg of messages.slice(0, 60)) {
      try {
        // Get metadata first (fast)
        const metaRes = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`,
          { headers: { Authorization: `Bearer ${googleToken}` } }
        );
        if (!metaRes.ok) continue;
        const meta = await metaRes.json();

        const headers = meta.payload?.headers ?? [];
        const subject = headers.find((h: any) => h.name === "Subject")?.value ?? "";
        const from = headers.find((h: any) => h.name === "From")?.value ?? "";
        const dateStr = headers.find((h: any) => h.name === "Date")?.value ?? "";
        const snippet = meta.snippet ?? "";

        // Quick check — does subject/snippet contain a flight number?
        const quickText = subject + " " + snippet;
        const quickFlight = extractFlightNumber(quickText);

        let fullText = quickText;
        let flightNumber = quickFlight;

        // If no flight number in snippet, fetch full email body
        if (!flightNumber) {
          fullText = await fetchFullEmailText(msg.id, googleToken);
          flightNumber = extractFlightNumber(fullText);
        }

        if (!flightNumber) continue;

        const airlineCode = flightNumber.substring(0, 2);
        const airline = AIRLINE_NAMES[airlineCode] ?? airlineCode;
        const { dep, arr } = extractAirports(fullText);
        const flightDate = extractDate(fullText, dateStr);

        const key = `${flightNumber}-${flightDate}`;
        if (seen.has(key)) continue;
        seen.add(key);

        toInsert.push({
          user_id: userId,
          airline,
          flight_number: flightNumber,
          departure_airport: dep,
          arrival_airport: arr,
          departure_date: flightDate,
          raw_email_snippet: snippet.substring(0, 200),
        });
      } catch {
        continue;
      }
    }

    // Clear old flights for this user and re-insert clean data
    if (toInsert.length > 0) {
      await (supabase as any).from("flights").insert(toInsert);
    }

    return { detected: messages.length, inserted: toInsert.length };
  });

export const clearAndRescan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    // Delete all existing flights for this user
    await (supabase as any).from("flights").delete().eq("user_id", userId);
    return { cleared: true };
  });

export const listFlights = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await (supabase as any)
      .from("flights")
      .select("*")
      .eq("user_id", userId)
      .order("departure_date", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const listClaims = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await (supabase as any)
      .from("claims")
      .select("*, flights(airline, flight_number, departure_airport, arrival_airport, departure_date)")
      .eq("user_id", userId)
      .order("filed_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const getProfile = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await (supabase as any)
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  });
