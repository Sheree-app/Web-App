import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const CATEGORIES = [
  "Something is broken",
  "Booking or payment",
  "Account or login",
  "Safety concern",
] as const;

Deno.serve(async (request) => {
  if (request.method === "OPTIONS")
    return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST")
    return json({ error: "Method not allowed" }, 405);
  try {
    const authorization = request.headers.get("Authorization");
    if (!authorization) return json({ error: "Authentication required" }, 401);
    const client = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authorization } } },
    );
    const {
      data: { user },
    } = await client.auth.getUser();
    if (!user) return json({ error: "Authentication required" }, 401);

    const body = await request.json().catch(() => ({}));
    const category = typeof body.category === "string" ? body.category : "";
    const details = typeof body.details === "string" ? body.details.trim() : "";
    const steps = typeof body.steps === "string" ? body.steps.trim() : "";
    const appMode = typeof body.appMode === "string" ? body.appMode : "customer";
    const platform =
      typeof body.platform === "string" ? body.platform : "unknown";

    if (!CATEGORIES.includes(category as (typeof CATEGORIES)[number])) {
      return json({ error: "Choose a valid problem category." }, 400);
    }
    if (details.length < 10 || details.length > 1000) {
      return json(
        { error: "Describe what happened in at least 10 characters." },
        400,
      );
    }
    if (steps.length > 700) {
      return json(
        { error: "Steps to reproduce must be 700 characters or fewer." },
        400,
      );
    }

    const priority =
      category === "Safety concern" ? "high" : "normal";
    const description = [
      `Category: ${category}`,
      `App mode: ${appMode}`,
      `Platform: ${platform}`,
      "",
      "What happened:",
      details,
      steps ? `\nSteps to reproduce:\n${steps}` : null,
    ]
      .filter((line): line is string => Boolean(line))
      .join("\n");

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data: ticket, error } = await admin
      .from("support_tickets")
      .insert({
        requester_id: user.id,
        kind: "report",
        subject: `Problem report: ${category}`,
        description,
        priority,
      })
      .select("id, ticket_number")
      .single();
    if (error) {
      console.error("report-problem insert failed", {
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint,
      });
      return json(
        { error: "Your report could not be submitted. Please try again." },
        500,
      );
    }

    return json({ submitted: true, ticket });
  } catch (error) {
    return json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unexpected report submission error",
      },
      500,
    );
  }
});
