// Admin-only edge function to update user name and email.
// Requires the caller to be authenticated with the 'admin' role.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders,
    });
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const ANON_KEY =
      Deno.env.get("SUPABASE_ANON_KEY") ??
      Deno.env.get("SUPABASE_PUBLISHABLE_KEY");

    if (!SUPABASE_URL) {
      return json({ error: "SUPABASE_URL is not configured" }, 500);
    }

    if (!SERVICE_ROLE_KEY) {
      return json({ error: "SUPABASE_SERVICE_ROLE_KEY is not configured" }, 500);
    }

    if (!ANON_KEY) {
      return json(
        {
          error:
            "SUPABASE_ANON_KEY or SUPABASE_PUBLISHABLE_KEY is not configured",
        },
        500
      );
    }

    const authHeader = req.headers.get("Authorization") ?? "";

    if (!authHeader.startsWith("Bearer ")) {
      return json({ error: "Unauthorized" }, 401);
    }

    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: {
        headers: {
          Authorization: authHeader,
        },
      },
    });

    const {
      data: { user },
      error: userErr,
    } = await userClient.auth.getUser();

    if (userErr || !user) {
      return json({ error: "Unauthorized" }, 401);
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const { data: roleRow, error: roleErr } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "admin")
      .maybeSingle();

    if (roleErr) {
      return json({ error: roleErr.message }, 500);
    }

    if (!roleRow) {
      return json({ error: "Admin only" }, 403);
    }

    const body = await req.json();

    const userId = String(body.userId ?? "").trim();
    const email = String(body.email ?? "").trim().toLowerCase();
    const fullName = String(body.full_name ?? "").trim();

    if (!userId) {
      return json({ error: "User ID is required" }, 400);
    }

    if (!email || !isValidEmail(email)) {
      return json({ error: "Valid email is required" }, 400);
    }

    const { data: existingProfile, error: profileErr } = await admin
      .from("profiles")
      .select("id,email,full_name")
      .eq("id", userId)
      .maybeSingle();

    if (profileErr) {
      return json({ error: profileErr.message }, 500);
    }

    if (!existingProfile) {
      return json({ error: "User profile not found" }, 404);
    }

    const { data: duplicateEmail, error: duplicateErr } = await admin
      .from("profiles")
      .select("id")
      .eq("email", email)
      .neq("id", userId)
      .maybeSingle();

    if (duplicateErr) {
      return json({ error: duplicateErr.message }, 500);
    }

    if (duplicateEmail) {
      return json({ error: "Another user already uses this email" }, 409);
    }

    const { error: authUpdateErr } = await admin.auth.admin.updateUserById(
      userId,
      {
        email,
        email_confirm: true,
        user_metadata: {
          full_name: fullName || email,
        },
      }
    );

    if (authUpdateErr) {
      return json({ error: authUpdateErr.message }, 400);
    }

    const { error: profileUpdateErr } = await admin
      .from("profiles")
      .update({
        email,
        full_name: fullName || null,
      })
      .eq("id", userId);

    if (profileUpdateErr) {
      return json({ error: profileUpdateErr.message }, 500);
    }

    return json({
      success: true,
      id: userId,
      email,
      full_name: fullName || null,
    });
  } catch (e) {
    return json(
      {
        error: e instanceof Error ? e.message : "Unknown error",
      },
      500
    );
  }
});

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}
