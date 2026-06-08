import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// ─── CONSTANTS ───────────────────────────────────────────────────────────────

const AIRLINE_MAP: Record<string, string> = {
  FR: "Ryanair", U2: "easyJet", W6: "Wizz Air", VY: "Vueling",
  KL: "KLM", AF: "Air France", LH: "Lufthansa", IB: "Iberia",
  BA: "British Airways", HV: "Transavia", DY: "Norwegian",
  TP: "TAP", TK: "Turkish Airlines", EK: "Emirates",
  UX: "Air Europa", UA: "United", DL: "Delta", AA: "American",
  QR: "Qatar Airways", EY: "Etihad", SK: "SAS", AY: "Finnair",
  LO: "LOT", A3: "Aegean", LX: "SWISS", OS: "Austrian",
  SN: "Brussels Airlines", V7: "Volotea", FR1: "Ryanair",
  BT: "airBaltic", PC: "Pegasus", XR: "Corendon", DE: "Condor",
};

// Sender domains to search — broad list
const AIRLINE_DOMAINS = [
  "ryanair.com", "easyjet.com", "wizzair.com", "vueling.com",
  "klm.com", "airfrance.com", "lufthansa.com", "iberia.com",
  "britishairways.com", "transavia.com", "norwegian.com", "tap.pt",
  "turkishairlines.com", "emirates.com", "aireuropa.com",
  "united.com", "delta.com", "aa.com", "qatarairways.com",
  "etihad.com", "flysas.com", "finnair.com", "lot.com", "swiss.com",
  "austrian.com", "brusselsairlines.com", "airbaltic.com",
  "flydubai.com", "condor.com", "volotea.com", "pegasusairlines.com",
  "sunexpress.com", "corendon.com", "tui.com",
  // Booking aggregators also send itineraries
  "edreams.com", "kiwi.com", "opodo.com", "lastminute.com",
  "bravofly.com", "trip.com", "expedia.com",
];

const ALL_AIRPORTS = new Set([
  // Spain
  "MAD","BCN","AGP","PMI","ALC","VLC","SVQ","BIO","TFS","LPA","ACE","FUE","IBZ","MAH",
  "SDR","SCQ","VGO","OVD","ZAZ","GRX","MJV","XRY","REU","GRO","PNA","OPO",
  // UK
  "LHR","LGW","STN","LTN","MAN","EDI","BHX","GLA","BRS","NCL","EMA","ABZ","BFS","CWL",
  // NL/BE/LU
  "AMS","EIN","RTM","BRU","LGG","LUX",
  // France
  "CDG","ORY","LYS","NCE","MRS","TLS","BOD","NTE","BSL","MPL",
  // Germany
  "FRA","MUC","BER","DUS","HAM","STR","CGN","NUE","HAJ","LEJ",
  // Italy
  "FCO","MXP","LIN","VCE","NAP","BLQ","PMO","CTA","CAG","BRI","TRN","VRN","PSA","FLR",
  // Portugal
  "LIS","OPO","FAO",
  // Scandinavia
  "CPH","ARN","GOT","OSL","BGO","TRD","HEL","RIX","TLL","VNO",
  // E. Europe
  "WAW","KRK","PRG","BUD","OTP","SOF","BEG","ZAG","LJU","SKP","TIA",
  // Greece/Cyprus
  "ATH","SKG","HER","RHO","CFU","KGS","LCA","PFO","CHQ",
  // Ireland
  "DUB","ORK","SNN",
  // Turkey
  "IST","SAW","AYT","ADB","ESB","ADA","TZX",
  // Middle East
  "DXB","AUH","DOH","AMM","BEY","CAI","TLV","MCT","KWI","BAH",
  // USA
  "JFK","EWR","LGA","LAX","ORD","ATL","DFW","MIA","BOS","SFO","SEA","DEN","IAD","IAH","PHX","LAS","MCO",
  // Asia
  "PEK","PKX","PVG","HKG","SIN","BKK","NRT","HND","ICN","KUL","CGK","MNL","DEL","BOM","DPS","CMB",
  // Other
  "YYZ","YVR","MEX","GRU","EZE","SCL","LIM","BOG","NBO","JNB","CPT","SYD","MEL","AKL",
]);

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function base64Decode(str: string): string {
  try {
    return decodeURIComponent(
      atob(str.replace(/-/g, "+").replace(/_/g, "/"))
        .split("")
        .map(c => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
        .join("")
    );
  } catch {
    return atob(str.replace(/-/g, "+").replace(/_/g, "/"));
  }
}

function extractBodyText(payload: any, depth = 0): string {
  if (depth > 5) return "";
  let text = "";
  if (payload?.body?.data) {
    try { text += base64Decode(payload.body.data); } catch { /* skip */ }
  }
  if (payload?.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === "text/plain") {
        if (part.body?.data) {
          try { text += base64Decode(part.body.data) + "\n"; } catch { /* skip */ }
        }
      } else if (part.mimeType?.startsWith("multipart/")) {
        text += extractBodyText(part, depth + 1);
      }
    }
    // Fallback to HTML if no plain text found
    if (!text.trim()) {
      for (const part of payload.parts) {
        if (part.mimeType === "text/html" && part.body?.data) {
          try {
            const html = base64Decode(part.body.data);
            text += html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
          } catch { /* skip */ }
        }
      }
    }
  }
  return text;
}

function extractFlightNumbers(text: string): string[] {
  const results: string[] = [];
  const seen = new Set<string>();
  // Standard airline code + number: KL1234, IB3456, FR1234
  const matches = text.matchAll(/\b([A-Z]{2})(\d{3,4})\b/g);
  for (const m of matches) {
    const code = m[1];
    const num = m[2];
    const full = code + num;
    if (AIRLINE_MAP[code] && !seen.has(full)) {
      seen.add(full);
      results.push(full);
    }
  }
  return results;
}

function extractRoute(text: string): { dep: string | null; arr: string | null } {
  // Priority 1: explicit arrow patterns like "AMS → MAD" or "AMS - MAD"
  const arrowPatterns = [
    /\b([A-Z]{3})\s*(?:→|->|➜|⟶|»)\s*([A-Z]{3})\b/g,
    /\b([A-Z]{3})\s*[-–—]\s*([A-Z]{3})\b/g,
    /\bfrom\s+([A-Z]{3})\s+to\s+([A-Z]{3})\b/gi,
  ];

  for (const re of arrowPatterns) {
    const m = re.exec(text);
    if (m) {
      const dep = m[1].toUpperCase();
      const arr = m[2].toUpperCase();
      if (ALL_AIRPORTS.has(dep) && ALL_AIRPORTS.has(arr) && dep !== arr) {
        return { dep, arr };
      }
    }
  }

  // Priority 2: city/airport name patterns
  const cityPatterns = [
    /(?:from|departure|origin)[:\s]+([A-Z][a-zA-Z\s]+?)[\s,]+(?:to|arrival|destination)[:\s]+([A-Z][a-zA-Z\s]+)/gi,
  ];
  // Map common city names to IATA
  const CITY_TO_IATA: Record<string, string> = {
    "madrid": "MAD", "amsterdam": "AMS", "barcelona": "BCN",
    "london heathrow": "LHR", "london gatwick": "LGW", "london stansted": "STN",
    "paris cdg": "CDG", "paris orly": "ORY", "paris": "CDG",
    "frankfurt": "FRA", "munich": "MUC", "berlin": "BER",
    "rome": "FCO", "milan": "MXP", "venice": "VCE",
    "lisbon": "LIS", "porto": "OPO",
    "istanbul": "IST", "istanbul sabiha": "SAW",
    "dubai": "DXB", "abu dhabi": "AUH", "doha": "DOH",
    "athens": "ATH", "vienna": "VIE", "zurich": "ZRH",
    "brussels": "BRU", "copenhagen": "CPH", "stockholm": "ARN",
    "oslo": "OSL", "helsinki": "HEL", "warsaw": "WAW",
    "dublin": "DUB", "new york jfk": "JFK", "new york": "JFK",
    "los angeles": "LAX", "chicago": "ORD", "miami": "MIA",
  };

  for (const re of cityPatterns) {
    const m = re.exec(text.toLowerCase());
    if (m) {
      const dep = CITY_TO_IATA[m[1].trim().toLowerCase()];
      const arr = CITY_TO_IATA[m[2].trim().toLowerCase()];
      if (dep && arr && dep !== arr) return { dep, arr };
    }
  }

  // Priority 3: find any two airports in order
  const codes = [...text.matchAll(/\b([A-Z]{3})\b/g)]
    .map(m => m[1])
    .filter(c => ALL_AIRPORTS.has(c));
  const unique = [...new Set(codes)];
  if (unique.length >= 2) {
    return { dep: unique[0], arr: unique[1] };
  }
  return { dep: null, arr: null };
}

function extractDate(text: string): string | null {
  const MONTHS: Record<string, string> = {
    jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
    jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
    january: "01", february: "02", march: "03", april: "04", june: "06",
    july: "07", august: "08", september: "09", october: "10", november: "11", december: "12",
  };

  const patterns = [
    // "7 June 2025" or "07 Jun 2025"
    /\b(\d{1,2})\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(20\d{2})\b/gi,
    // "June 7, 2025" or "Jun 07 2025"
    /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})[,\s]+(20\d{2})\b/gi,
    // ISO: 2025-06-07
    /\b(20\d{2})-(\d{2})-(\d{2})\b/g,
    // DD/MM/YYYY
    /\b(\d{2})\/(\d{2})\/(20\d{2})\b/g,
  ];

  for (const re of patterns) {
    const m = re.exec(text);
    if (!m) continue;

    let year: string, month: string, day: string;

    if (re.source.startsWith("\\b(\\d{1,2})")) {
      // Day Month Year
      day = m[1].padStart(2, "0");
      month = MONTHS[m[2].toLowerCase()] || "01";
      year = m[3];
    } else if (re.source.startsWith("\\b(jan")) {
      // Month Day Year
      month = MONTHS[m[1].toLowerCase()] || "01";
      day = m[2].padStart(2, "0");
      year = m[3];
    } else if (re.source.startsWith("\\b(20")) {
      // ISO
      year = m[1]; month = m[2]; day = m[3];
    } else {
      // DD/MM/YYYY
      day = m[1]; month = m[2]; year = m[3];
    }

    const parsed = new Date(`${year}-${month}-${day}`);
    if (!isNaN(parsed.getTime()) && parseInt(year) >= 2020) {
      return `${year}-${month}-${day}`;
    }
  }
  return null;
}

function guessAirlineFromEmail(fromHeader: string): string | null {
  const from = fromHeader.toLowerCase();
  if (from.includes("klm.com")) return "KLM";
  if (from.includes("ryanair")) return "Ryanair";
  if (from.includes("easyjet")) return "easyJet";
  if (from.includes("wizzair") || from.includes("wizz")) return "Wizz Air";
  if (from.includes("vueling")) return "Vueling";
  if (from.includes("airfrance") || from.includes("air-france")) return "Air France";
  if (from.includes("lufthansa")) return "Lufthansa";
  if (from.includes("iberia")) return "Iberia";
  if (from.includes("britishairways") || from.includes("british-airways")) return "British Airways";
  if (from.includes("transavia")) return "Transavia";
  if (from.includes("norwegian")) return "Norwegian";
  if (from.includes("tap.pt") || from.includes("tapair")) return "TAP";
  if (from.includes("turkishairlines") || from.includes("thy.com")) return "Turkish Airlines";
  if (from.includes("emirates")) return "Emirates";
  if (from.includes("united.com")) return "United";
  if (from.includes("delta.com")) return "Delta";
  if (from.includes("qatarairways")) return "Qatar Airways";
  return null;
}

// ─── MAIN SCAN FUNCTION ───────────────────────────────────────────────────────

export const scanGmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;

    const { data: profileData } = await (supabase as any)
      .from("profiles")
      .select("gmail_access_token")
      .eq("id", userId)
      .single();

    const googleToken = profileData?.gmail_access_token;
    if (!googleToken) {
      return { detected: 0, inserted: 0, error: "No Gmail token — please sign out and back in" };
    }

    // ── Step 1: Search Gmail for flight emails ──────────────────────────────
    const domainQuery = AIRLINE_DOMAINS.map(d => `from:${d}`).join(" OR ");
    const fullQuery = `(${domainQuery}) (booking OR confirmation OR itinerary OR "boarding pass" OR "e-ticket" OR "your flight" OR "travel itinerary" OR "reservation") newer_than:1095d`;

    const listRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(fullQuery)}&maxResults=100`,
      { headers: { Authorization: `Bearer ${googleToken}` } }
    );

    if (!listRes.ok) {
      const errText = await listRes.text();
      console.error("Gmail list error:", listRes.status, errText);
      if (listRes.status === 401) {
        return { detected: 0, inserted: 0, error: "Gmail token expired — please sign out and back in" };
      }
      return { detected: 0, inserted: 0, error: `Gmail API error ${listRes.status}` };
    }

    const listData = await listRes.json();
    const messages: any[] = listData.messages ?? [];

    if (messages.length === 0) {
      return { detected: 0, inserted: 0, error: "No flight emails found in Gmail" };
    }

    // ── Step 2: Clear existing flights for a clean rescan ──────────────────
    await (supabase as any).from("flights").delete().eq("user_id", userId);

    // ── Step 3: Parse each email ───────────────────────────────────────────
    // Key: "FLIGHTNUM-DATE" → best flight data found
    const flightMap = new Map<string, any>();

    for (const msg of messages.slice(0, 80)) {
      try {
        const fullRes = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=full`,
          { headers: { Authorization: `Bearer ${googleToken}` } }
        );
        if (!fullRes.ok) continue;
        const full = await fullRes.json();

        const headers = full.payload?.headers ?? [];
        const subject = headers.find((h: any) => h.name === "Subject")?.value ?? "";
        const from = headers.find((h: any) => h.name === "From")?.value ?? "";
        const dateHeader = headers.find((h: any) => h.name === "Date")?.value ?? "";

        // Skip emails that are clearly not booking confirmations
        const subjectLower = subject.toLowerCase();
        if (
          subjectLower.includes("survey") ||
          subjectLower.includes("newsletter") ||
          subjectLower.includes("promotion") ||
          subjectLower.includes("offer") ||
          subjectLower.includes("miles") ||
          subjectLower.includes("feedback") ||
          subjectLower.includes("check-in") ||
          subjectLower.includes("checkin")
        ) continue;

        // Extract full body text
        const bodyText = extractBodyText(full.payload);
        const allText = subject + "\n" + bodyText;

        // Detect flight numbers
        const flightNums = extractFlightNumbers(allText);
        if (flightNums.length === 0) continue;

        // Get route
        const { dep, arr } = extractRoute(allText);

        // Get date — try body first, fall back to email receipt date
        let flightDate = extractDate(allText);
        if (!flightDate) {
          // Use email date as approximate fallback
          const emailDate = new Date(dateHeader);
          if (!isNaN(emailDate.getTime())) {
            flightDate = emailDate.toISOString().split("T")[0];
          }
        }

        // Detect airline from sender email or flight number
        const airlineFromEmail = guessAirlineFromEmail(from);
        const primaryFlight = flightNums[0];
        const airlineCode = primaryFlight.substring(0, 2);
        const airline = airlineFromEmail || AIRLINE_MAP[airlineCode] || airlineCode;

        if (!flightDate) continue;

        // For each flight number found, create/update a record
        for (const fn of flightNums.slice(0, 3)) {
          const key = `${fn}-${flightDate}`;
          const existing = flightMap.get(key);

          // Keep the record with the most complete data
          const newRecord = {
            user_id: userId,
            airline,
            flight_number: fn,
            departure_airport: dep,
            arrival_airport: arr,
            departure_date: flightDate,
            raw_email_snippet: (full.snippet ?? "").substring(0, 200),
          };

          if (!existing) {
            flightMap.set(key, newRecord);
          } else {
            // Merge: fill in missing fields
            if (!existing.departure_airport && dep) existing.departure_airport = dep;
            if (!existing.arrival_airport && arr) existing.arrival_airport = arr;
            flightMap.set(key, existing);
          }
        }
      } catch (err) {
        console.warn("Error parsing message:", err);
        continue;
      }
    }

    // ── Step 4: Filter and insert ──────────────────────────────────────────
    const toInsert = [...flightMap.values()].filter(f => {
      // Must have at least a flight number and date
      if (!f.flight_number || !f.departure_date) return false;
      // Skip if date is in the far future (probably a parsing error)
      const d = new Date(f.departure_date);
      if (isNaN(d.getTime())) return false;
      if (d.getFullYear() > 2027) return false;
      return true;
    });

    if (toInsert.length > 0) {
      const { error: insertErr } = await (supabase as any).from("flights").insert(toInsert);
      if (insertErr) console.error("Insert error:", insertErr);
    }

    return { detected: messages.length, inserted: toInsert.length };
  });

export const clearAndRescan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
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
