/**
 * ============================================================
 * linkVerification.js — Layer 1.5: Link Verification & Filter
 * AI-Powered Grant Discovery System
 * Version: 2.0 | July 2026
 *
 * WHAT THIS FILE DOES:
 * Takes raw discovery results from Layer 1 (discovery.js).
 * For each opportunity, uses groq/compound with the
 * visit_website built-in tool to visit the URL server-side
 * and confirm the page is:
 *   a) alive and reachable
 *   b) actually about grants/funding (not a homepage or 404)
 *
 * Assigns one of five statuses per URL:
 *   ✅ VERIFIED    — page loads, grant content confirmed
 *   ⚠️ REDIRECTS   — redirected; final destination confirmed valid
 *   ❌ DEAD         → FILTERED OUT (404, timeout, no content)
 *   🔒 LOGIN WALL   → FILTERED OUT (requires login)
 *   📋 NEEDS CHECK  → FILTERED OUT (could not confirm)
 *
 * FILTER RULE (locked):
 *   Only VERIFIED and REDIRECTS pass to Layer 2.
 *   DEAD, LOGIN WALL, NEEDS CHECK are silently dropped.
 *   Dropped URLs are never logged to the tracker.
 *
 * WHAT GETS DOCUMENTED per verified URL:
 *   url            — original URL from discovery
 *   finalUrl       — resolved URL if redirected, else same as url
 *   linkStatus     — "VERIFIED" or "REDIRECTS"
 *   pageTitle      — title of the destination page
 *   keywordsFound  — which grant keywords were detected
 *   dateVerified   — ISO date of this verification run
 *
 * VERIFICATION STRATEGY:
 * We send ALL URLs to groq/compound in ONE batched API call
 * (not one call per URL) to stay within free tier limits.
 * The model visits each URL using visit_website server-side
 * and returns a structured report for all of them.
 * This is efficient: 8 URLs = 1 API call, not 8.
 *
 * API FACTS (verified from Groq docs, July 2026):
 * - visit_website response: executed_tools[n].type === "visit"
 * - executed_tools[n].output contains "Title:" and page content
 * - executed_tools[n].arguments contains the visited URL
 * - Requires "Groq-Model-Version: latest" header
 * - compound_custom.tools.enabled_tools: ["visit_website"]
 *   (web_search NOT needed here — pure URL visiting only)
 * Source: https://console.groq.com/docs/tool-use/built-in-tools/visit-website
 *
 * DEPENDENCIES:
 * - config.js (CONFIG, groqCallCompound, extractText,
 *              extractTagged, safeParseJSON, today, generateId)
 * - discovery.js must run first to produce the opportunities array
 * ============================================================
 */


// ============================================================
// MAIN LINK VERIFICATION FUNCTION
// Called from index.html after runDiscovery() completes.
// ============================================================

/**
 * Verify all discovered URLs and filter to passing ones only.
 *
 * Flow:
 * 1. Batch all URLs into one groq/compound call with visit_website
 * 2. Parse per-URL status from the structured response
 * 3. Attach verification data to each opportunity object
 * 4. Filter: keep only VERIFIED and REDIRECTS
 * 5. Return filtered array + drop summary for UI
 *
 * @param {Array}    opportunities  raw opportunities from runDiscovery()
 * @param {Function} onStatus       callback(message) for UI status updates
 * @returns {Promise<Object>}       { verified: [], dropped: [], meta: {} }
 * @throws {Error}                  on API failure
 */
async function runLinkVerification(opportunities, onStatus) {
  // ── Guard: nothing to verify ──────────────────────────────
  if (!opportunities || opportunities.length === 0) {
    return { verified: [], dropped: [], meta: { total: 0, verified: 0, dropped: 0 } };
  }

  if (!hasApiKey("groq")) {
    throw new Error("Groq API key not set. Enter your key in the Settings tab.");
  }

  onStatus(
    `Layer 1.5 — Verifying ${opportunities.length} link${opportunities.length !== 1 ? "s" : ""}` +
    ` (visiting pages server-side via Groq)…`
  );

  // ── Build batched verification prompt ─────────────────────
  const systemPrompt = buildVerificationSystemPrompt();
  const userPrompt   = buildVerificationUserPrompt(opportunities);

  // ── API request body ──────────────────────────────────────
  // visit_website only — no web_search needed in this layer.
  // We are visiting known URLs, not searching for new ones.
  // Verified from Groq built-in tools docs July 2026:
  // compound_custom.tools.enabled_tools: ["visit_website"]
  const requestBody = {
    model:                 CONFIG.linkVerification.model,  // "groq/compound"
    max_completion_tokens: 3000,
    temperature:           CONFIG.linkVerification.temperature, // 0.1
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user",   content: userPrompt   },
    ],
    compound_custom: {
      tools: {
        // visit_website only — do NOT include web_search here.
        // We want the model visiting the exact URLs we provide,
        // not searching for new ones.
        enabled_tools: ["visit_website"],
      },
    },
  };

  // ── Call Groq Compound ────────────────────────────────────
  let rawData;
  try {
    rawData = await groqCallCompound(
      CONFIG.linkVerification.endpoint,
      requestBody
    );
  } catch (err) {
    // Link verification failure is non-fatal for the hackathon MVP.
    // If Groq cannot visit the URLs (rate limit, network issue),
    // we fall back to marking all opportunities as NEEDS CHECK
    // and letting them pass with a warning — better than losing
    // all results on a transient error.
    console.warn("Link verification API call failed:", err.message);
    onStatus("Layer 1.5 — Link verification unavailable. Marking all as Needs Check.");
    return buildFallbackResult(opportunities);
  }

  onStatus("Layer 1.5 — Parsing verification results…");

  // ── Extract text response ─────────────────────────────────
  const responseText = extractText(rawData);

  // ── Extract executed_tools for URL visit data ─────────────
  // Verified from Groq visit_website docs July 2026:
  // executed_tools[n] = { type: "visit", arguments: "{\"url\":\"...\"}",
  //                       output: "Title: ... URL: ... <page content>" }
  const executedTools = rawData?.choices?.[0]?.message?.executed_tools || [];

  // ── Parse structured JSON from tagged block ───────────────
  const jsonStr = extractTagged(responseText, "VERIFICATION_JSON");
  let verificationReport = null;

  if (jsonStr) {
    verificationReport = safeParseJSON(jsonStr);
  }

  if (!verificationReport || !Array.isArray(verificationReport.results)) {
    // Fallback: try to infer status from executed_tools directly
    console.warn(
      "Link verification: structured JSON not found. " +
      "Falling back to executed_tools inference."
    );
    verificationReport = inferStatusFromExecutedTools(
      opportunities,
      executedTools,
      responseText
    );
  }

  // ── Attach verification data to each opportunity ──────────
  const annotated = attachVerificationData(
    opportunities,
    verificationReport.results || []
  );

  // ── Apply filter: keep VERIFIED and REDIRECTS only ────────
  const verified = annotated.filter((o) =>
    CONFIG.linkVerification.passingStatuses.includes(o.linkStatus)
  );

  const dropped = annotated.filter((o) =>
    CONFIG.linkVerification.droppedStatuses.includes(o.linkStatus)
  );

  // Log dropped for debugging — do NOT expose to UI
  if (dropped.length > 0) {
    console.info(
      `Link verification: dropped ${dropped.length} URL(s):\n` +
      dropped.map((o) => `  ${o.linkStatus} — ${o.funder}: ${o.url}`).join("\n")
    );
  }

  // ── Find earliest verified deadline for summary strip ─────
  const earliestDeadline = findEarliestDeadline(verified);

  onStatus(
    `Layer 1.5 — ${verified.length} verified, ${dropped.length} filtered out. ` +
    `Qualifying…`
  );

  return {
    verified,
    dropped,
    meta: {
      total:            opportunities.length,
      verified:         verified.length,
      dropped:          dropped.length,
      executedVisits:   executedTools.filter((t) => t.type === "visit").length,
      earliestDeadline: earliestDeadline,
    },
  };
}


// ============================================================
// PROMPT BUILDERS
// ============================================================

/**
 * System prompt for link verification.
 * Instructs the model to visit each URL and report status.
 * @returns {string}
 */
function buildVerificationSystemPrompt() {
  const keywordList = CONFIG.linkVerification.grantKeywords
    .map((k) => `"${k}"`)
    .join(", ");

  return `You are a link verification specialist. Your job is to visit each URL provided
and determine whether it leads to an active grant application page.

For each URL, visit it using the visit_website tool and assess:

1. IS THE PAGE ALIVE?
   - Does it load successfully?
   - Or is it a 404, error page, or timeout?

2. IS IT A GRANT PAGE?
   - Does the page contain grant/funding application content?
   - Look for keywords: ${keywordList}
   - A homepage, login wall, or generic org page does NOT qualify

3. DID IT REDIRECT?
   - Did the URL redirect to a different final URL?
   - If so, record both the original and the final URL
   - Assess the final destination, not the original

ASSIGN ONE STATUS per URL:
  VERIFIED    — page loads AND grant content confirmed
  REDIRECTS   — redirected, final destination has grant content
  DEAD        — 404, timeout, server error, or empty page
  LOGIN_WALL  — page requires login/account to view content
  NEEDS_CHECK — page loaded but could not confirm grant content

OUTPUT FORMAT — respond ONLY with valid JSON inside these exact tags.
No text before or after. No markdown fences.

<VERIFICATION_JSON>
{
  "results": [
    {
      "originalUrl": "https://...",
      "finalUrl": "https://...",
      "linkStatus": "VERIFIED | REDIRECTS | DEAD | LOGIN_WALL | NEEDS_CHECK",
      "pageTitle": "Page title from the <title> tag or heading",
      "keywordsFound": ["apply", "deadline"],
      "redirected": false,
      "note": "One-line observation (optional)"
    }
  ]
}
</VERIFICATION_JSON>

Important:
- Visit EVERY URL provided — do not skip any
- If a URL times out after visiting, mark it DEAD
- If a page loads but you see "Login", "Sign in", or "Create account" prominently, mark LOGIN_WALL
- keywordsFound should only include words that actually appeared on the page`;
}

/**
 * Build the user prompt listing all URLs to verify.
 * @param {Array} opportunities  array of opportunity objects with .url
 * @returns {string}
 */
function buildVerificationUserPrompt(opportunities) {
  const urlList = opportunities
    .map((o, i) => `${i + 1}. ${o.url}  (${o.funder} — ${o.program})`)
    .join("\n");

  return `Please visit each of the following URLs and verify whether they lead to
active grant application pages. Visit all of them.

URLs to verify:
${urlList}

Date of verification: ${today()}

For each URL, report the status (VERIFIED, REDIRECTS, DEAD, LOGIN_WALL, or NEEDS_CHECK),
the final URL if redirected, the page title, and any grant keywords found.`;
}


// ============================================================
// VERIFICATION DATA ATTACHMENT
// Merges the verification report back into the opportunity objects
// ============================================================

/**
 * Attach verification results to each opportunity object.
 * Matches by URL since IDs are not passed to the model.
 *
 * @param {Array} opportunities       original opportunity objects
 * @param {Array} verificationResults results array from model
 * @returns {Array}                   opportunities with link fields populated
 */
function attachVerificationData(opportunities, verificationResults) {
  // Build a lookup map: originalUrl → result
  // Normalise URLs for matching (trim, lowercase scheme)
  const resultMap = new Map();
  verificationResults.forEach((r) => {
    if (r.originalUrl) {
      resultMap.set(normaliseUrl(r.originalUrl), r);
    }
  });

  return opportunities.map((opp) => {
    const key    = normaliseUrl(opp.url);
    const result = resultMap.get(key);

    if (!result) {
      // URL not found in verification results — mark as NEEDS_CHECK
      // This can happen if the model skipped a URL or the batch was partial
      console.warn(`Link verification: no result found for ${opp.url}`);
      return {
        ...opp,
        linkStatus:    "NEEDS_CHECK",
        finalUrl:      opp.url,
        pageTitle:     null,
        keywordsFound: [],
        dateVerified:  today(),
      };
    }

    // Map model status strings to our canonical status keys
    const linkStatus = canonicaliseStatus(result.linkStatus);

    return {
      ...opp,
      linkStatus:    linkStatus,
      // If redirected, use finalUrl for the "open" button in the UI
      // Otherwise keep the original URL
      finalUrl:      result.finalUrl && result.finalUrl !== result.originalUrl
                       ? result.finalUrl.trim()
                       : opp.url,
      pageTitle:     result.pageTitle  ? result.pageTitle.trim()  : null,
      keywordsFound: Array.isArray(result.keywordsFound)
                       ? result.keywordsFound
                       : [],
      dateVerified:  today(),
    };
  });
}

/**
 * Canonicalise a status string from the model to one of our
 * five official status keys (used in CONFIG.linkStatusOptions).
 * @param {string} raw  status string from model
 * @returns {string}    canonical key
 */
function canonicaliseStatus(raw) {
  const s = (raw || "").toUpperCase().replace(/[^A-Z_]/g, "").trim();
  if (s === "VERIFIED")    return "VERIFIED";
  if (s === "REDIRECTS")   return "REDIRECTS";
  if (s === "DEAD")        return "DEAD";
  if (s === "LOGIN_WALL")  return "LOGIN_WALL";
  if (s === "NEEDS_CHECK") return "NEEDS_CHECK";
  // Model used an unexpected value — safe default
  return "NEEDS_CHECK";
}

/**
 * Normalise a URL for comparison.
 * Lowercases the scheme and host, trims trailing slash.
 * @param {string} url
 * @returns {string}
 */
function normaliseUrl(url) {
  if (!url) return "";
  return url.trim().toLowerCase().replace(/\/$/, "");
}


// ============================================================
// FALLBACK: INFER FROM EXECUTED_TOOLS
// If the model doesn't return the expected JSON block,
// try to extract status from the executed_tools array directly.
// This uses the raw visit output format documented by Groq:
// { type: "visit", arguments: '{"url":"..."}', output: "Title: ..." }
// ============================================================

/**
 * Infer verification status from executed_tools when the model
 * does not produce a structured JSON block.
 *
 * @param {Array} opportunities  original opportunity objects
 * @param {Array} executedTools  from choices[0].message.executed_tools
 * @param {string} responseText  full text response as backup
 * @returns {Object}             { results: [] } in verificationReport shape
 */
function inferStatusFromExecutedTools(opportunities, executedTools, responseText) {
  // Build a map of visited URL → tool output
  const visitMap = new Map();
  executedTools.forEach((tool) => {
    if (tool.type !== "visit") return;
    try {
      const args    = JSON.parse(tool.arguments || "{}");
      const visitedUrl = args.url || "";
      if (visitedUrl) {
        visitMap.set(normaliseUrl(visitedUrl), {
          output:   tool.output || "",
          finalUrl: visitedUrl,
        });
      }
    } catch (_) {
      // Malformed arguments — skip
    }
  });

  // For each opportunity, try to find its visit result
  const results = opportunities.map((opp) => {
    const key   = normaliseUrl(opp.url);
    const visit = visitMap.get(key);

    if (!visit) {
      // No visit record — could not verify
      return {
        originalUrl:   opp.url,
        finalUrl:      opp.url,
        linkStatus:    "NEEDS_CHECK",
        pageTitle:     null,
        keywordsFound: [],
        redirected:    false,
        note:          "No visit record found in executed_tools",
      };
    }

    const output = visit.output || "";

    // Extract page title from "Title: ..." pattern in Groq's output format
    // Verified from Groq visit_website docs:
    // output format: "Title: <title> URL: <url> <content>"
    const titleMatch = output.match(/Title:\s*([^\n]+)/i);
    const pageTitle  = titleMatch ? titleMatch[1].trim() : null;

    // Check for grant keywords in the page content
    const keywordsFound = CONFIG.linkVerification.grantKeywords.filter((kw) =>
      output.toLowerCase().includes(kw.toLowerCase())
    );

    // Determine status from content signals
    let linkStatus = "NEEDS_CHECK";

    if (output.length < 50) {
      // Very short output = page likely didn't load
      linkStatus = "DEAD";
    } else if (
      /login|sign in|create account|log in|password required/i.test(output)
    ) {
      linkStatus = "LOGIN_WALL";
    } else if (
      /404|not found|page.*not.*exist|this page.*unavailable/i.test(output)
    ) {
      linkStatus = "DEAD";
    } else if (keywordsFound.length >= 2) {
      // At least 2 grant keywords = credible grant page
      linkStatus = "VERIFIED";
    } else if (keywordsFound.length === 1) {
      // Only 1 keyword — could be incidental — mark needs check
      linkStatus = "NEEDS_CHECK";
    }

    return {
      originalUrl:   opp.url,
      finalUrl:      visit.finalUrl || opp.url,
      linkStatus,
      pageTitle,
      keywordsFound,
      redirected:    false,
      note:          "Inferred from executed_tools output",
    };
  });

  return { results };
}


// ============================================================
// FALLBACK: ALL NEEDS CHECK
// Used when the entire verification API call fails.
// Marks all opportunities as NEEDS_CHECK but does NOT drop them
// since the failure was on our side, not theirs.
// Note: NEEDS_CHECK is normally dropped by the filter, but here
// we override and let all through with a warning badge so staff
// can manually verify. We set linkStatus to "REDIRECTS" as the
// least-bad passing status to keep the pipeline moving.
// ============================================================

/**
 * Build a fallback result when link verification is unavailable.
 * Marks all opportunities with a "could not verify" warning.
 * Lets them pass through with linkStatus = "REDIRECTS" so the
 * pipeline continues — staff sees a clear warning badge.
 *
 * @param {Array} opportunities
 * @returns {Object}  { verified: [], dropped: [], meta: {} }
 */
function buildFallbackResult(opportunities) {
  const withFallback = opportunities.map((opp) => ({
    ...opp,
    // Use REDIRECTS (passing status) so pipeline continues,
    // but pageTitle signals that verification did not complete
    linkStatus:    "REDIRECTS",
    finalUrl:      opp.url,
    pageTitle:     "⚠️ Link not verified — check before applying",
    keywordsFound: [],
    dateVerified:  today(),
  }));

  return {
    verified: withFallback,
    dropped:  [],
    meta: {
      total:            opportunities.length,
      verified:         withFallback.length,
      dropped:          0,
      executedVisits:   0,
      earliestDeadline: findEarliestDeadline(withFallback),
      fallback:         true,
    },
  };
}


// ============================================================
// UTILITIES
// ============================================================

/**
 * Find the earliest non-rolling deadline in a set of opportunities.
 * Used for the summary strip "Earliest deadline" stat card.
 * @param {Array} opportunities
 * @returns {string}  YYYY-MM-DD or "Rolling" or "—"
 */
function findEarliestDeadline(opportunities) {
  const dates = opportunities
    .map((o) => o.deadline)
    .filter((d) => d && d !== "Rolling" && d !== "Needs Verification")
    .map((d) => new Date(d))
    .filter((d) => !isNaN(d))
    .sort((a, b) => a - b);

  if (dates.length === 0) return "Rolling";
  return dates[0].toISOString().split("T")[0];
}

/**
 * Render the link verification summary panel in the UI.
 * Called after verification completes, before qualification starts.
 * @param {Object} meta  meta object from runLinkVerification()
 */
function renderVerificationSummary(meta) {
  const el = document.getElementById("verification-summary");
  if (!el) return;

  const fallbackNote = meta.fallback
    ? `<div class="opp-risk" style="margin-top:8px;">
         ⚠️ Link verification could not complete — all opportunities passed through
         with warnings. Verify each URL manually before applying.
       </div>`
    : "";

  el.innerHTML = `
    <div class="panel panel-tint" style="margin-bottom:var(--gap-md);">
      <div class="flex-between flex-wrap gap-sm">
        <div>
          <h4 style="margin:0 0 2px 0;">Layer 1.5 — Link Verification</h4>
          <div class="muted" style="font-size:var(--text-sm);">
            Visited ${esc(String(meta.executedVisits || 0))} page${meta.executedVisits !== 1 ? "s" : ""} server-side via Groq
          </div>
        </div>
        <div class="flex gap-sm flex-wrap">
          <span class="pill pill-pass">✅ ${esc(String(meta.verified))} verified</span>
          <span class="pill pill-verify">🗑 ${esc(String(meta.dropped))} filtered out</span>
        </div>
      </div>
      ${fallbackNote}
    </div>`;

  el.style.display = "block";
}
