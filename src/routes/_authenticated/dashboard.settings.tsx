import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Check, Mail, Upload, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/dashboard/settings")({
  head: () => ({ meta: [{ title: "Settings — Flew" }] }),
  component: SettingsPage,
});

function SettingsPage() {
  const navigate = useNavigate();
  const [profile, setProfile] = useState<any>(null);
  const [email, setEmail] = useState("");
  const [uploading, setUploading] = useState(false);

  async function load() {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    setEmail(u.user.email ?? "");
    const { data } = await (supabase as any).from("profiles").select("*").eq("id", u.user.id).single();
    setProfile(data);
  }
  useEffect(() => { load(); }, []);

  async function reupload(file: File) {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    setUploading(true);
    const path = `${u.user.id}/passport-${Date.now()}-${file.name}`;
    const { error } = await supabase.storage.from("documents").upload(path, file);
    if (error) { toast.error(error.message); setUploading(false); return; }
    await (supabase as any).from("profiles").update({ passport_uploaded: true }).eq("id", u.user.id);
    toast.success("Passport replaced");
    setUploading(false);
    load();
  }

  async function deleteAccount() {
    if (!confirm("Delete account permanently? This cannot be undone.")) return;
    await supabase.auth.signOut();
    toast.success("Signed out — contact support to fully delete data");
    navigate({ to: "/" });
  }

  return (
    <div className="p-10 max-w-3xl">
      <div className="mb-10">
        <div className="label mb-2">// Settings</div>
        <h1 className="font-display text-6xl">Account</h1>
      </div>

      <Section title="Gmail">
        <Row label="Connected account" value={email} icon={<Mail className="w-4 h-4" />} status="Connected" />
      </Section>

      <Section title="Documents">
        <Row label="Passport" value={profile?.passport_uploaded ? "On file" : "Not uploaded"} status={profile?.passport_uploaded ? "Ready" : "Missing"} />
        <label className="btn-ghost cursor-pointer mt-4 inline-flex">
          <Upload className="w-4 h-4" /> {uploading ? "Uploading..." : "Replace passport"}
          <input type="file" accept="image/*,application/pdf" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) reupload(f); }} />
        </label>
      </Section>

      <Section title="Payout method">
        {profile?.payout_method === "paypal" && <Row label="PayPal" value={profile.paypal_email} />}
        {profile?.payout_method === "bank" && <Row label="IBAN" value={profile.iban} />}
        {!profile?.payout_method && <Row label="Not set" value="—" status="Missing" />}
      </Section>

      <Section title="Danger zone" danger>
        <button onClick={async () => { await supabase.auth.signOut(); navigate({ to: "/" }); }} className="btn-ghost mr-3">
          Disconnect Gmail
        </button>
        <button onClick={deleteAccount} className="btn-ghost border-destructive text-destructive">
          <Trash2 className="w-4 h-4" /> Delete account
        </button>
      </Section>
    </div>
  );
}

function Section({ title, children, danger }: { title: string; children: React.ReactNode; danger?: boolean }) {
  return (
    <div className={`card-surface p-8 mb-6 ${danger ? "border-destructive/30" : ""}`}>
      <h2 className="font-display text-2xl mb-6">{title}</h2>
      {children}
    </div>
  );
}

function Row({ label, value, status, icon }: { label: string; value: string; status?: string; icon?: React.ReactNode }) {
  const isReady = status === "Connected" || status === "Ready";
  return (
    <div className="flex items-center justify-between py-3 border-b border-border last:border-0">
      <div>
        <div className="label flex items-center gap-2">{icon}{label}</div>
        <div className="font-mono text-sm mt-1">{value}</div>
      </div>
      {status && (
        <span className={`label flex items-center gap-2 ${isReady ? "text-acid" : "text-muted-foreground"}`}>
          {isReady && <Check className="w-3 h-3" />} {status}
        </span>
      )}
    </div>
  );
}
