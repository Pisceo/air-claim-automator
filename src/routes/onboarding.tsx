import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Check, Upload, ArrowRight, Plane, Mail } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { notifyOnboardingComplete } from "@/lib/webhook.functions";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

export const Route = createFileRoute("/onboarding")({
  head: () => ({ meta: [{ title: "Onboarding — Flew" }] }),
  component: Onboarding,
});

function Onboarding() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [userId, setUserId] = useState<string | null>(null);
  const [email, setEmail] = useState<string>("");
  const [passportUploaded, setPassportUploaded] = useState(false);
  const [uploading, setUploading] = useState(false);

  // Payout
  const [method, setMethod] = useState<"paypal" | "bank">("paypal");
  const [paypalEmail, setPaypalEmail] = useState("");
  const [iban, setIban] = useState("");
  const [bic, setBic] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) { navigate({ to: "/auth" }); return; }
      setUserId(data.user.id);
      setEmail(data.user.email ?? "");
      (supabase as any).from("profiles").select("*").eq("id", data.user.id).single().then(({ data: p }: { data: any }) => {
        if (p) {
          setPassportUploaded(p.passport_uploaded);
          if (p.onboarding_complete) navigate({ to: "/dashboard" });
        }
      });
    });
  }, [navigate]);

  async function uploadPassport(file: File) {
    if (!userId) return;
    setUploading(true);
    const path = `${userId}/passport-${Date.now()}-${file.name}`;
    const { error } = await supabase.storage.from("documents").upload(path, file, { upsert: true });
    if (error) { toast.error("Upload failed", { description: error.message }); setUploading(false); return; }
    await (supabase as any).from("profiles").update({ passport_uploaded: true }).eq("id", userId);
    setPassportUploaded(true);
    setUploading(false);
    toast.success("Passport uploaded");
  }

  async function savePayout() {
    if (!userId) return;
    if (method === "paypal" && !paypalEmail) { toast.error("Enter your PayPal email"); return; }
    if (method === "bank" && (!iban || !bic)) { toast.error("Enter IBAN and BIC"); return; }
    setSaving(true);
    const { error } = await (supabase as any).from("profiles").update({
      payout_method: method,
      paypal_email: method === "paypal" ? paypalEmail : null,
      iban: method === "bank" ? iban : null,
      bic: method === "bank" ? bic : null,
      onboarding_complete: true,
    }).eq("id", userId);
    setSaving(false);
    if (error) { toast.error("Save failed", { description: error.message }); return; }
    toast.success("Setup complete — monitoring now");
    navigate({ to: "/dashboard" });
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border">
        <div className="max-w-4xl mx-auto px-6 py-5 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2">
            <div className="w-7 h-7 bg-acid flex items-center justify-center">
              <Plane className="w-4 h-4 text-background" strokeWidth={2.5} />
            </div>
            <span className="font-display text-2xl">FLEW</span>
          </Link>
          <span className="label">Step {step} of 3</span>
        </div>
        {/* Progress bar */}
        <div className="h-[3px] bg-surface">
          <div className="h-full bg-acid transition-all duration-300" style={{ width: `${(step / 3) * 100}%` }} />
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-6 py-16">
        {step === 1 && (
          <Card>
            <Eyebrow>// Step 1 — Gmail</Eyebrow>
            <H>Your Gmail is connected.</H>
            <div className="card-surface p-5 my-8 flex items-center gap-4">
              <div className="w-10 h-10 bg-acid flex items-center justify-center"><Check className="w-5 h-5 text-background" strokeWidth={3} /></div>
              <div className="flex-1">
                <div className="label flex items-center gap-2"><Mail className="w-3 h-3" /> Connected account</div>
                <div className="font-mono text-sm mt-1">{email || "loading..."}</div>
              </div>
            </div>
            <p className="text-muted-foreground text-sm mb-8">We'll scan the last 3 months and watch for new booking emails from major EU carriers.</p>
            <button className="btn-acid w-full" onClick={() => setStep(2)}>Continue <ArrowRight className="w-4 h-4" /></button>
          </Card>
        )}

        {step === 2 && (
          <Card>
            <Eyebrow>// Step 2 — Passport</Eyebrow>
            <H>Upload your passport.</H>
            <p className="text-muted-foreground text-sm mb-8">Airlines require it for every claim. Upload once — we'll attach it forever.</p>
            {passportUploaded ? (
              <div className="card-surface p-5 mb-6 flex items-center gap-4">
                <div className="w-10 h-10 bg-acid flex items-center justify-center"><Check className="w-5 h-5 text-background" strokeWidth={3} /></div>
                <div><div className="label">Status</div><div className="font-mono text-sm mt-1">Passport on file</div></div>
              </div>
            ) : (
              <label className="card-surface block p-10 text-center cursor-pointer hover:bg-surface-2 transition-colors mb-6 border-dashed">
                <input type="file" accept="image/*,application/pdf" className="hidden" disabled={uploading}
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadPassport(f); }} />
                <Upload className="w-8 h-8 mx-auto mb-3 text-muted-foreground" />
                <div className="label">{uploading ? "Uploading..." : "Click to upload image or PDF"}</div>
              </label>
            )}
            <div className="flex gap-3">
              <button className="btn-ghost flex-1" onClick={() => setStep(1)}>Back</button>
              <button className="btn-acid flex-1" disabled={!passportUploaded} onClick={() => setStep(3)}>Continue <ArrowRight className="w-4 h-4" /></button>
            </div>
          </Card>
        )}

        {step === 3 && (
          <Card>
            <Eyebrow>// Step 3 — Payout</Eyebrow>
            <H>Where should we send the money?</H>

            <div className="grid grid-cols-2 gap-3 my-8">
              <MethodBtn active={method === "paypal"} onClick={() => setMethod("paypal")} label="PayPal" />
              <MethodBtn active={method === "bank"} onClick={() => setMethod("bank")} label="Bank / IBAN" />
            </div>

            {method === "paypal" ? (
              <Field label="PayPal email">
                <input type="email" value={paypalEmail} onChange={e => setPaypalEmail(e.target.value)} placeholder="you@example.com" className="input" />
              </Field>
            ) : (
              <div className="space-y-4">
                <Field label="IBAN"><input value={iban} onChange={e => setIban(e.target.value.toUpperCase())} placeholder="ES91 2100 0418 4502 0005 1332" className="input" /></Field>
                <Field label="BIC / SWIFT"><input value={bic} onChange={e => setBic(e.target.value.toUpperCase())} placeholder="CAIXESBBXXX" className="input" /></Field>
              </div>
            )}

            <div className="flex gap-3 mt-8">
              <button className="btn-ghost flex-1" onClick={() => setStep(2)}>Back</button>
              <button className="btn-acid flex-1" disabled={saving} onClick={savePayout}>{saving ? "Saving..." : "Complete setup"}</button>
            </div>
          </Card>
        )}
      </main>
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return <div className="card-surface p-10">{children}</div>;
}
function Eyebrow({ children }: { children: React.ReactNode }) { return <div className="label mb-4">{children}</div>; }
function H({ children }: { children: React.ReactNode }) { return <h1 className="font-display text-5xl">{children}</h1>; }

function MethodBtn({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button onClick={onClick} className={`p-4 border font-mono text-xs uppercase tracking-wider transition-colors ${active ? "bg-acid text-background border-acid" : "bg-transparent border-border hover:bg-surface-2"}`}>
      {label}
    </button>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="label mb-2">{label}</div>
      {children}
    </div>
  );
}
