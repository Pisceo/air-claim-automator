import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// MOCK Gmail scan — returns sample flights and inserts any new ones into the user's flights table.
// Swap this for a real Gmail API call when Google Cloud OAuth credentials are wired in.
const MOCK_FLIGHTS = [
  { airline: "Ryanair",      flight_number: "FR1822", departure_airport: "MAD", arrival_airport: "STN", departure_date: "2025-03-14", raw_email_snippet: "Your Ryanair booking confirmation FR1822 MAD → STN" },
  { airline: "easyJet",      flight_number: "U24521", departure_airport: "AMS", arrival_airport: "BCN", departure_date: "2025-04-02", raw_email_snippet: "easyJet booking U24521 confirmed" },
  { airline: "Vueling",      flight_number: "VY8512", departure_airport: "CDG", arrival_airport: "MAD", departure_date: "2025-04-21", raw_email_snippet: "Vueling itinerary VY8512" },
  { airline: "Lufthansa",    flight_number: "LH441",  departure_airport: "FRA", arrival_airport: "LHR", departure_date: "2025-05-09", raw_email_snippet: "Lufthansa boarding pass LH441" },
  { airline: "Iberia",       flight_number: "IB3214", departure_airport: "MAD", arrival_airport: "AMS", departure_date: "2025-05-22", raw_email_snippet: "Iberia booking confirmation IB3214" },
  { airline: "KLM",          flight_number: "KL1696", departure_airport: "AMS", arrival_airport: "BCN", departure_date: "2025-06-04", raw_email_snippet: "Your KLM e-ticket KL1696" },
  { airline: "Wizz Air",     flight_number: "W62301", departure_airport: "BUD", arrival_airport: "BCN", departure_date: "2025-06-18", raw_email_snippet: "Wizz Air booking W62301" },
];

export const scanGmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;

    // Fetch existing flight numbers
    const { data: existing } = await (supabase as any).from("flights").select("flight_number, departure_date").eq("user_id", userId);
    const seen = new Set((existing ?? []).map((f: any) => `${f.flight_number}-${f.departure_date}`));

    const toInsert = MOCK_FLIGHTS
      .filter(f => !seen.has(`${f.flight_number}-${f.departure_date}`))
      .map(f => ({ ...f, user_id: userId }));

    if (toInsert.length > 0) {
      const { error } = await (supabase as any).from("flights").insert(toInsert);
      if (error) throw new Error(error.message);
    }

    return { detected: MOCK_FLIGHTS.length, inserted: toInsert.length };
  });

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
    const { data, error } = await (supabase as any).from("profiles").select("*").eq("id", userId).single();
    if (error) throw new Error(error.message);
    return data;
  });
