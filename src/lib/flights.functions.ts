import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

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
      return insertMockFlights(supabase, userId);
    }

    const query = encodeURIComponent(
      'from:(ryanair.com OR easyjet.com OR wizzair.com OR vueling.com OR klm.com OR airfrance.com OR lufthansa.com OR iberia.com OR britishairways.com OR transavia.com OR norwegian.com OR tap.pt OR turkishairlines.com OR emirates.com OR aireuropa.com) (booking OR confirmation OR itinerary OR "boarding pass" OR "your flight") newer_than:1095d'
    );

    const listRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${query}&maxResults=50`,
      { headers: { Authorization: `Bearer ${googleToken}` } }
    );

    if (!listRes.ok) {
      console.warn("Gmail API error", await listRes.text());
      return insertMockFlights(supabase, userId);
    }

    const listData = await listRes.json();
    const messages = listData.messages ?? [];

    const { data: existing } = await (supabase as any).from("flights").select("flight_number, departure_date").eq("user_id", userId);
    const seen = new Set((existing ?? []).map((f: any) => `${f.flight_number}-${f.departure_date}`));

    const toInsert: any[] = [];

    const FLIGHT_RE = /\b([A-Z]{2}\d{3,4})\b/g;
    const EU_AIRPORTS = new Set(["MAD","BCN","LIS","CDG","ORY","AMS","FRA","MUC","LHR","LGW","STN","LTN","FCO","MXP","VCE","ATH","WAW","PRG","BUD","VIE","ZRH","BRU","CPH","ARN","OSL","HEL","DUB","IST","LCA","OPO","SVQ","PMI","AGP","ALC","VLC","BIO","TFS","LPA"]);
    const AIRLINE_NAMES: Record<string,string> = {"FR":"Ryanair","U2":"easyJet","W6":"Wizz Air","VY":"Vueling","KL":"KLM","AF":"Air France","LH":"Lufthansa","IB":"Iberia","BA":"British Airways","HV":"Transavia","DY":"Norwegian","TP":"TAP Air Portugal","TK":"Turkish Airlines","EK":"Emirates","UX":"Air Europa"};

    for (const msg of messages.slice(0, 25)) {
      try {
        const detailRes = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`,
          { headers: { Authorization: `Bearer ${googleToken}` } }
        );
        if (!detailRes.ok) continue;
        const detail = await detailRes.json();

        const headers = detail.payload?.headers ?? [];
        const subject = headers.find((h: any) => h.name === "Subject")?.value ?? "";
        const dateStr = headers.find((h: any) => h.name === "Date")?.value ?? "";
        const snippet = detail.snippet ?? "";
        const fullText = subject + " " + snippet;

        const flightMatches = [...fullText.matchAll(FLIGHT_RE)].map(m => m[1]);
        if (flightMatches.length === 0) continue;
        const flightNumber = flightMatches[0];
        const airlineCode = flightNumber.substring(0, 2);
        const airline = AIRLINE_NAMES[airlineCode] ?? airlineCode;

        const iataCodes = [...fullText.matchAll(/\b([A-Z]{3})\b/g)].map(m => m[1]).filter(c => EU_AIRPORTS.has(c));
        const dep = iataCodes[0] ?? null;
        const arr = iataCodes[1] ?? null;

        const dateMatch = fullText.match(/(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(202\d)/i)
          ?? fullText.match(/(202\d[-\/]\d{2}[-\/]\d{2})/);
        let flightDate: string | null = null;
        if (dateMatch) {
          const parsed = new Date(dateMatch[0]);
          if (!isNaN(parsed.getTime())) flightDate = parsed.toISOString().split("T")[0];
        }
        if (!flightDate) flightDate = new Date(dateStr).toISOString().split("T")[0];

        const key = `${flightNumber}-${flightDate}`;
        if (seen.has(key)) continue;
        seen.add(key);

        toInsert.push({ user_id: userId, airline, flight_number: flightNumber, departure_airport: dep, arrival_airport: arr, departure_date: flightDate, raw_email_snippet: snippet.substring(0, 200) });
      } catch { continue; }
    }

    if (toInsert.length > 0) {
      await (supabase as any).from("flights").insert(toInsert);
    }

    return { detected: messages.length, inserted: toInsert.length };
  });

async function insertMockFlights(supabase: any, userId: string) {
  const MOCK_FLIGHTS = [
    { airline: "Ryanair", flight_number: "FR1822", departure_airport: "MAD", arrival_airport: "STN", departure_date: "2025-03-14", raw_email_snippet: "Your Ryanair booking confirmation" },
    { airline: "Iberia", flight_number: "IB3214", departure_airport: "MAD", arrival_airport: "AMS", departure_date: "2025-05-22", raw_email_snippet: "Iberia booking confirmation" },
  ];
  const { data: existing } = await (supabase as any).from("flights").select("flight_number").eq("user_id", userId);
  const seen = new Set((existing ?? []).map((f: any) => f.flight_number));
  const toInsert = MOCK_FLIGHTS.filter(f => !seen.has(f.flight_number)).map(f => ({ ...f, user_id: userId }));
  if (toInsert.length > 0) await (supabase as any).from("flights").insert(toInsert);
  return { detected: MOCK_FLIGHTS.length, inserted: toInsert.length, mock: true };
}

export const listFlights = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await (supabase as any).from("flights").select("*").eq("user_id", userId).order("departure_date", { ascending: false });
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
    const { data, error } = await (supabase as any).from("profiles").select("*").eq("id", userId).maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  });
