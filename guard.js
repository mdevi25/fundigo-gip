/**
 * ============================================================
 * guard.js — Layer 2.5: Language, Bias & Accuracy Guard
 * AI-Powered Grant Discovery System
 * Version: 1.0 | July 2026
 *
 * WHAT THIS FILE DOES:
 * Runs every qualified opportunity through a policy-based
 * safety and quality check before it reaches the UI or tracker.
 *
 * Uses openai/gpt-oss-safeguard-20b — a bring-your-own-policy
 * classifier. We write the policy; it enforces it consistently.
 *
 * FOUR CHECKS PER OPPORTUNITY:
 *
 *   CHECK 1 — LANGUAGE QUALITY
 *   Is the language professional and grant-appropriate?
 *   No jargon, overpromising, inflammatory or loaded terms?
 *   Suitable for a nonprofit staff member to act on?
 *
 *   CHECK 2 — BIAS DETECTION
 *   Geographic bias in funder descriptions?
 *   Racial or demographic bias in eligibility framing?
 *   Socioeconomic bias in how populations are described?
 *   ERE serves diverse communities — language must reflect that.
 *
 *   CHECK 3 — ACCURACY FLAGS
 *   Claims stated as facts that should be "Needs Verification"?
 *   Absolute statements about deadlines/amounts unconfirmed?
 *   Any fabricated statistics or invented partnerships?
 *
 *   CHECK 4 — NONPROFIT APPROPRIATENESS
 *   Tone appropriate for ERE's mission and funder relationships?
 *   Nothing that could harm ERE's reputation with funders?
 *
 * OUTPUT PER OPPORTUNITY:
 *   guardStatus: "PASS" → renders normally in UI
 *   guardStatus: "FLAG" → renders with ⚠️ warning badge
 *                         staff sees exactly what was flagged
 *                         staff decides whether to act
 *
 * GUARD MODE: Soft flag (locked — never hard block)
 *   Reason: hard blocking risks dropping valid grants due to
 *   false positives. Human oversight is the final safety layer.
 *
 * API FACTS (verified from Groq docs, July 2026):
 *   Model:    openai/gpt-oss-safeguard-20b
 *   Endpoint: https://api.groq.com/openai/v1/chat/completions
 *   Pattern:  bring-your-own-policy classifier
 *   Response: choices[0].message.content = JSON string
 *             { "violation": 0|1, "category": null|string,
 *               "rationale": "..." }
 *   No special headers — standard groqCall() works
 *   Deprecated replacement for: meta-llama/llama-guard-4-12b
 *     (deprecated Feb 10, 2026 per Groq deprecation docs)
 * Source: https://console.groq.com/docs/model/openai/gpt-oss-safeguard-20b
 *         https://console.groq.com/docs/content-moderation
 *
 * DEPENDENCIES:
 *   config.js (CONFIG, groqCall, extractText, safeParseJSON,
 *              today, esc)
 * ============================================================
 */


// ============================================================
// GUARD POLICY
// Written in natural language — gpt-oss-safeguard-20b reads
// this policy and applies it to each opportunity's text.
// This is the "bring-your-own-policy" pattern verified from
// Groq content moderation docs.
// ============================================================

/**
 * The ERE grant discovery guard policy.
 * Defines exactly what constitutes a violation across four
 * check categories. The safeguard model interprets and
 * enforces this policy for each piece of content evaluated.
 * @returns {string}  policy text for system message
 */
function buildGuardPolicy() {
  return `# ERE Grant Discovery Guard Policy

## ROLE
You are a content quality and safety classifier for a nonprofit
grant discovery system. You evaluate AI-generated grant
opportunity descriptions before they are shown to nonprofit staff.

## TASK
Classify whether the content provided violates any of the four
policies below. Evaluate ALL four checks and flag if ANY one fails.

## POLICY 1 — LANGUAGE QUALITY
VIOLATES if content contains ANY of:
- Jargon that a nonprofit staff member would not understand
- Overpromising language ("guaranteed funding", "easy grant")
- Inflammatory, alarmist, or emotionally manipulative language
- Vague or meaningless filler phrases ("synergistic impact")
- Language that is not professional or grant-appropriate

SAFE if:
- Language is clear, professional, and action-oriented
- Terminology is standard in the nonprofit grant sector
- Tone is neutral, informative, and mission-centered

## POLICY 2 — BIAS DETECTION
VIOLATES if content contains ANY of:
- Geographic bias: implying certain locations are inferior or
  undeserving (e.g., "despite being in a disadvantaged area")
- Racial or demographic bias: describing populations in ways
  that stereotype, diminish, or generalize by race, ethnicity,
  religion, or socioeconomic background
- Deficit framing: describing communities served only in terms
  of what they lack rather than their strengths and resilience
- Othering language: language that separates "us" from "them"
  when describing underserved populations

SAFE if:
- Populations are described with dignity and specificity
- Geographic references are factual and neutral
- Focus is on opportunity and mission, not deficit

## POLICY 3 — ACCURACY FLAGS
VIOLATES if content contains ANY of:
- Claims stated as confirmed facts that are unverified
  (e.g., "This grant is open" without verification)
- Specific dollar amounts stated with certainty when the
  source data was approximate or unclear
- Specific deadlines stated as confirmed when the source
  said "Needs Verification"
- Invented statistics, partnerships, or outcomes
- Absolute statements ("always", "never", "guaranteed")
  about grant availability or eligibility

SAFE if:
- Uncertain information is appropriately hedged
  ("approximately", "verify directly", "as reported")
- Verified information is stated clearly
- No invented or fabricated data is present

## POLICY 4 — NONPROFIT APPROPRIATENESS
VIOLATES if content contains ANY of:
- Language that could damage ERE's relationship with funders
- Political statements or partisan framing
- Content that misrepresents ERE's programs or mission
- Language suggesting ERE would misuse or mismanage funds
- Anything that would embarrass ERE if a program officer read it

SAFE if:
- Content is appropriate for a program officer to read
- ERE's mission is represented accurately and professionally
- No political, partisan, or reputationally risky content

## OUTPUT FORMAT
Respond ONLY with valid JSON. No text before or after. No fences.

{
  "violation": 0,
  "category": null,
  "checks": {
    "languageQuality": 0,
    "biasDetection": 0,
    "accuracyFlags": 0,
    "nonprofitAppropriateness": 0
  },
  "issues": [],
  "rationale": "One sentence explaining the overall assessment"
}

Where:
  violation: 1 if ANY check fails, 0 if all pass
  category:  name of the first failing check, or null if all pass
  checks:    1 = failed, 0 = passed for each individual check
  issues:    array of specific issues found (empty if all pass)
  rationale: one sentence summary of the assessment`;
}


// ============================================================
// MAIN GUARD FUNCTION
// ============================================================

/**
 * Run the guard check on all qualified opportunities.
 *
 * Flow:
 * 1. For each opportunity, build the content to evaluate
 * 2. Call gpt-oss-safeguard-20b with the ERE guard policy
 * 3. Parse the structured JSON violation report
 * 4. Attach guardStatus, guardIssues, guardNote to each opportunity
 * 5. Return all opportunities (PASS and FLAG both included)
 *    — soft flag mode: nothing is dropped by the guard
 *
 * @param {Array}    opportunities  qualified opps from Layer 2
 * @param {Function} onStatus       callback(message) for UI updates
 * @returns {Promise<Object>}
 *   { checked: [], meta: { total, passed, flagged } }
 * @throws {Error}  on API failure
 */
async function runGuard(opportunities, onStatus) {
  // ── Guard: nothing to check ───────────────────────────────
  if (!opportunities || opportunities.length === 0) {
    return {
      checked: [],
      meta: { total: 0, passed: 0, flagged: 0 }
    };
  }

  if (!hasApiKey("groq")) {
    throw new Error("Groq API key not set. Enter your key in Settings.");
  }

  onStatus(
    `Layer 2.5 — Running guard checks on ${opportunities.length} ` +
    `opportunit${opportunities.length !== 1 ? "ies" : "y"} ` +
    `(language, bias, accuracy, appropriateness)…`
  );

  // ── Build the policy (same for all opportunities) ─────────
  const policy = buildGuardPolicy();

  // ── Check each opportunity individually ───────────────────
  // We check one at a time (not batched) because:
  // 1. The safeguard model is designed for single-item classification
  // 2. Batching risks cross-contamination between evaluations
  // 3. Each opportunity needs an independent verdict
  // 4. At ERE's volume (≤8 opportunities), this is 8 small API calls
  //    which fits well within free tier limits
  const results = [];

  for (let i = 0; i < opportunities.length; i++) {
    const opp = opportunities[i];

    onStatus(
      `Layer 2.5 — Checking ${i + 1} of ${opportunities.length}: ${opp.funder}…`
    );

    const guardResult = await checkOneOpportunity(opp, policy);

    results.push({
      ...opp,
      guardStatus: guardResult.violation === 1 ? "FLAG" : "PASS",
      guardIssues: guardResult.issues || [],
      guardNote:   guardResult.rationale || "",
      guardChecks: guardResult.checks || {},
    });

    // Small delay between calls to be respectful of rate limits
    // 500ms between calls = well within 30 RPM free tier limit
    if (i < opportunities.length - 1) {
      await sleep(500);
    }
  }

  // ── Count outcomes ────────────────────────────────────────
  const passed  = results.filter((o) => o.guardStatus === "PASS").length;
  const flagged = results.filter((o) => o.guardStatus === "FLAG").length;

  if (flagged > 0) {
    console.info(
      `Guard: ${flagged} opportunit${flagged !== 1 ? "ies" : "y"} flagged:\n` +
      results
        .filter((o) => o.guardStatus === "FLAG")
        .map((o) => `  FLAG — ${o.funder}: ${o.guardNote}`)
        .join("\n")
    );
  }

  onStatus(
    `Layer 2.5 — Guard complete. ` +
    `${passed} passed, ${flagged} flagged for staff review.`
  );

  return {
    checked: results,
    meta: {
      total:   results.length,
      passed,
      flagged,
    },
  };
}


// ============================================================
// SINGLE OPPORTUNITY GUARD CHECK
// ============================================================

/**
 * Check a single opportunity against the guard policy.
 * Returns the parsed guard verdict object.
 *
 * @param {Object} opp     opportunity object
 * @param {string} policy  guard policy text (from buildGuardPolicy)
 * @returns {Promise<Object>}
 *   { violation: 0|1, category: null|string,
 *     checks: {}, issues: [], rationale: "" }
 */
async function checkOneOpportunity(opp, policy) {
  // ── Build content to evaluate ─────────────────────────────
  // Include all the text fields that will be shown to staff
  const contentToCheck = buildContentForGuard(opp);

  // ── API request ───────────────────────────────────────────
  // Verified pattern from Groq content moderation docs:
  // - System message = the policy
  // - User message   = the content to classify
  // - Response       = JSON { violation, category, rationale }
  // We extend the response schema to include checks[] and issues[]
  const requestBody = {
    model:                 CONFIG.guard.model, // "openai/gpt-oss-safeguard-20b"
    max_completion_tokens: 500,   // guard responses are small JSON objects
    temperature:           CONFIG.guard.temperature, // 0.0 = fully deterministic
    messages: [
      { role: "system", content: policy          },
      { role: "user",   content: contentToCheck  },
    ],
  };

  let rawData;
  try {
    rawData = await groqCall(CONFIG.guard.endpoint, requestBody);
  } catch (err) {
    // Guard failure is non-fatal — soft-flag and continue
    console.warn(
      `Guard: API call failed for "${opp.funder}": ${err.message}`
    );
    return buildGuardFallback(
      `Guard check could not complete (${err.message.slice(0, 80)}). ` +
      `Verify this opportunity manually before applying.`
    );
  }

  // ── Extract and parse response ────────────────────────────
  const responseText = extractText(rawData);

  if (!responseText || responseText.trim().length === 0) {
    return buildGuardFallback(
      "Guard check returned empty response. Verify manually."
    );
  }

  // ── Parse the JSON verdict ────────────────────────────────
  // gpt-oss-safeguard-20b returns JSON directly in content —
  // no tags needed (it is trained to output JSON directly)
  const parsed = safeParseJSON(responseText);

  if (!parsed) {
    // Model returned non-JSON — try to extract JSON substring
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const recovered = safeParseJSON(jsonMatch[0]);
      if (recovered) return normaliseGuardResult(recovered);
    }
    console.warn(
      `Guard: non-JSON response for "${opp.funder}": `,
      responseText.slice(0, 200)
    );
    return buildGuardFallback(
      "Guard check could not parse results. Verify manually."
    );
  }

  return normaliseGuardResult(parsed);
}

/**
 * Build the text content sent to the guard for evaluation.
 * Includes all human-visible fields from the opportunity.
 * @param {Object} opp
 * @returns {string}
 */
function buildContentForGuard(opp) {
  return `Evaluate the following grant opportunity description
for language quality, bias, accuracy, and nonprofit appropriateness.

FUNDER: ${opp.funder}
PROGRAM: ${opp.program}
AMOUNT: ${opp.amount}
DEADLINE: ${opp.deadline}
STATUS: ${opp.appStatus}
GEOGRAPHY: ${opp.geoEligibility}
ELIGIBILITY: ${opp.orgEligibility}
MISSION ALIGNMENT: ${opp.missionAlignment || ""}
WHY QUALIFIES: ${opp.whyQualifies || ""}
RISKS/FLAGS: ${opp.risks || "none"}
RECOMMENDED ACTION: ${opp.recommendedAction || ""}
SOURCE NOTE: ${opp.sourceNote || ""}
PAGE TITLE: ${opp.pageTitle || ""}

Evaluate ALL four policy checks and return the JSON verdict.`;
}

/**
 * Normalise a raw guard result to a consistent shape.
 * Handles variations in how the model formats the response.
 * @param {Object} raw  parsed JSON from model
 * @returns {Object}    normalised guard result
 */
function normaliseGuardResult(raw) {
  return {
    violation: raw.violation === 1 || raw.violation === true ? 1 : 0,
    category:  raw.category  || null,
    checks: {
      languageQuality:          raw.checks?.languageQuality          || 0,
      biasDetection:            raw.checks?.biasDetection            || 0,
      accuracyFlags:            raw.checks?.accuracyFlags            || 0,
      nonprofitAppropriateness: raw.checks?.nonprofitAppropriateness || 0,
    },
    issues:    Array.isArray(raw.issues)   ? raw.issues   : [],
    rationale: typeof raw.rationale === "string"
      ? raw.rationale.trim()
      : "No rationale provided",
  };
}

/**
 * Build a fallback guard result when the API call or parse fails.
 * Soft-flags the opportunity so staff knows to verify manually.
 * @param {string} reason  explanation for the flag
 * @returns {Object}       guard result in normalised shape
 */
function buildGuardFallback(reason) {
  return {
    violation: 1,   // flag so staff sees the warning
    category:  "Guard check incomplete",
    checks: {
      languageQuality:          0,
      biasDetection:            0,
      accuracyFlags:            0,
      nonprofitAppropriateness: 0,
    },
    issues:    [reason],
    rationale: reason,
  };
}


// ============================================================
// UTILITIES
// ============================================================

/**
 * Simple async sleep helper.
 * Used between guard API calls to avoid rate limit spikes.
 * @param {number} ms  milliseconds to wait
 * @returns {Promise}
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}


// ============================================================
// UI HELPERS
// ============================================================

/**
 * Render the guard summary panel in the UI.
 * Called after all guard checks complete.
 * @param {Object} meta  from runGuard()
 */
function renderGuardSummary(meta) {
  const el = document.getElementById("guard-summary");
  if (!el) return;

  const flagNote = meta.flagged > 0
    ? `<div class="opp-guard-flag" style="margin-top:var(--gap-sm);">
         ⚠️ ${esc(String(meta.flagged))} opportunit${meta.flagged !== 1 ? "ies" : "y"}
         flagged for staff review. These are shown with a warning badge below.
         Staff must review flagged items before adding to the tracker.
       </div>`
    : "";

  el.innerHTML = `
    <div class="panel panel-tint" style="margin-bottom:var(--gap-md);">
      <div class="flex-between flex-wrap gap-sm">
        <div>
          <h4 style="margin:0 0 2px 0;">Layer 2.5 — Guard Check</h4>
          <div class="muted" style="font-size:var(--text-sm);">
            model: <span class="mono">${esc(CONFIG.guard.model)}</span>
            · policy: language, bias, accuracy, appropriateness
            · mode: soft flag
          </div>
        </div>
        <div class="flex gap-sm flex-wrap">
          <span class="pill pill-pass">✅ ${esc(String(meta.passed))} passed</span>
          ${meta.flagged > 0
            ? `<span class="pill pill-flag">⚠️ ${esc(String(meta.flagged))} flagged</span>`
            : ""}
        </div>
      </div>
      ${flagNote}
    </div>`;

  el.style.display = "block";
}

/**
 * Render a guard detail block for a single opportunity.
 * Called inside renderOpportunityCard() in discovery.js
 * when guardStatus === "FLAG".
 * @param {Object} opp  opportunity with guard fields populated
 * @returns {string}    HTML string
 */
function renderGuardDetail(opp) {
  if (!opp.guardStatus || opp.guardStatus === "PASS") return "";

  const failedChecks = Object.entries(opp.guardChecks || {})
    .filter(([, v]) => v === 1)
    .map(([k]) => ({
      languageQuality:          "Language quality",
      biasDetection:            "Bias detected",
      accuracyFlags:            "Accuracy concern",
      nonprofitAppropriateness: "Appropriateness concern",
    }[k] || k));

  const checksHtml = failedChecks.length
    ? `<div style="margin-top:4px;">
         Failed checks:
         ${failedChecks.map((c) => `<span class="pill pill-flag" style="margin-left:4px;">${esc(c)}</span>`).join("")}
       </div>`
    : "";

  const issuesHtml = opp.guardIssues && opp.guardIssues.length
    ? `<ul style="margin:6px 0 0 16px;font-size:var(--text-xs);">
         ${opp.guardIssues.map((i) => `<li>${esc(i)}</li>`).join("")}
       </ul>`
    : "";

  return `
    <div class="opp-guard-flag">
      <b>⚠️ Staff review needed before acting on this opportunity:</b>
      ${opp.guardNote ? `<div style="margin-top:3px;">${esc(opp.guardNote)}</div>` : ""}
      ${checksHtml}
      ${issuesHtml}
      <div style="margin-top:6px;font-size:var(--text-xs);color:var(--amber);">
        This opportunity is shown for staff awareness.
        Verify the flagged items before adding to the tracker.
      </div>
    </div>`;
}

/**
 * Get a human-readable label for a guard check key.
 * Used in the Settings tab memory panel.
 * @param {string} checkKey
 * @returns {string}
 */
function guardCheckLabel(checkKey) {
  return {
    languageQuality:          "Language quality",
    biasDetection:            "Bias detection",
    accuracyFlags:            "Accuracy flags",
    nonprofitAppropriateness: "Nonprofit appropriateness",
  }[checkKey] || checkKey;
}
