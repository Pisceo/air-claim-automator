import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { FileCheck } from "lucide-react";
import { listClaims } from "@/lib/flights.functions";

export const Route = createFileRoute("/_authenticated/dashboard/claims")({
  head: () => ({ meta: [{ title: "My Claims — Flew" }] }),
  component: ClaimsPage,
});

const STATUS_COLOR: Record<string, string> = {
  filed: "text-foreground",
  airline_responded: "text-foreground",
  escalated: "text-foreground",
  won: "text-acid",
  lost: "text-muted-foreground",
};

function ClaimsPage() {
  const fn = useServerFn(listClaims);
  const claims = useQuery({ queryKey: ["claims"], queryFn: () => fn() });

  return (
    <div className="p-10 max-w-6xl">
      <div className="mb-10">
        <div className="label mb-2">// My Claims</div>
        <h1 className="font-display text-6xl">Compensation claims</h1>
      </div>

      {claims.data?.length === 0 ? (
        <div className="card-surface p-16 text-center">
          <FileCheck className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
          <div className="font-display text-3xl mb-2">No claims yet</div>
          <div className="text-muted-foreground text-sm max-w-md mx-auto">
            We're watching your flights. When something is delayed 3h+, cancelled, or overbooked, we file automatically.
          </div>
        </div>
      ) : (
        <div className="card-surface overflow-hidden">
          <table className="w-full font-mono text-sm">
            <thead>
              <tr className="border-b border-border">
                <Th>Flight</Th><Th>Filed</Th><Th>Status</Th><Th>Amount</Th><Th>Payout</Th>
              </tr>
            </thead>
            <tbody>
              {claims.data?.map((c: any) => (
                <tr key={c.id} className="border-b border-border">
                  <Td>{c.flights?.flight_number} · {c.flights?.departure_airport} → {c.flights?.arrival_airport}</Td>
                  <Td>{new Date(c.filed_at).toLocaleDateString()}</Td>
                  <Td><span className={`label ${STATUS_COLOR[c.status]}`}>{c.status.replace("_", " ")}</span></Td>
                  <Td>€{c.amount_eur ?? "—"}</Td>
                  <Td>{c.resolved_at ? new Date(c.resolved_at).toLocaleDateString() : "—"}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) { return <th className="text-left p-4 label">{children}</th>; }
function Td({ children }: { children: React.ReactNode }) { return <td className="p-4">{children}</td>; }
