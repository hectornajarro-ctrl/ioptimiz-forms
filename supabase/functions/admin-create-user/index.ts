// Admin-only edge function to provision users.
// Requires the caller to be authenticated with the 'admin' role.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Role = "admin" | "lead_auditor" | "member_auditor";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const auth = req.headers.get("Authorization") ?? "";
    if (!auth.startsWith("Bearer ")) {
      return json({ error: "Unauthorized" }, 401);
    }

    // Identify caller
    const userClient = createClient(SUPABASE_URL, ANON, {
      global: { headers: { Authorization: auth } },
    });
    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) return json({ error: "Unauthorized" }, 401);

    // Check admin role
    const admin = createClient(SUPABASE_URL, SERVICE);
    const { data: roleRows, error: roleErr } = await admin
      .from("user_roles").select("role").eq("user_id", user.id).eq("role", "admin");
    if (roleErr) return json({ error: roleErr.message }, 500);
    if (!roleRows || roleRows.length === 0) return json({ error: "Admin only" }, 403);

    const body = await req.json();
    const email = String(body.email ?? "").trim().toLowerCase();
    const password = String(body.password ?? "");
    const fullName = String(body.full_name ?? "").trim();
    const roles: Role[] = Array.isArray(body.roles) ? body.roles : [];

    if (!email || !password || password.length < 6) {
      return json({ error: "Email and password (min 6 chars) required" }, 400);
    }

    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName || email },
    });
    if (createErr || !created.user) return json({ error: createErr?.message ?? "Create failed" }, 400);

    const newId = created.user.id;

    // Trigger handle_new_user already inserted profile + default member_auditor role.
    // Apply requested roles.
    if (roles.length > 0) {
      // Remove default if a different set is requested
      await admin.from("user_roles").delete().eq("user_id", newId);
      const inserts = roles.map((r) => ({ user_id: newId, role: r }));
      const { error: insErr } = await admin.from("user_roles").insert(inserts);
      if (insErr) return json({ error: insErr.message }, 500);
    }

    if (fullName) {
      await admin.from("profiles").update({ full_name: fullName }).eq("id", newId);
    }

    return json({ id: newId, email });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
