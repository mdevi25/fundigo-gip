/**
 * ============================================================
 * matchScoring.js — ERE grant match-tier logic
 * Fundigo
 *
 * SOURCE OF TRUTH: 2026-GrantMatchScoring.txt (E.R.E, confirmed)
 * Two corrections applied per confirmation:
 *   - "Ok Match Criteria" outputs "OK" (doc said "GOOD" — typo)
 *   - "No Match Criteria" item 1 references "OK" (doc said
 *     "LOW", which isn't a defined tier — typo)
 *
 * WHY THIS IS A SEPARATE, PURE, DETERMINISTIC FUNCTION:
 * qualification.js asks the AI to extract four FACTS about a
 * grant (subject area, grade level, geography, nonprofit
 * eligibility) — reading comprehension, which LLMs are good at.
 * The actual HIGH/GOOD/OK/NO decision is a fixed waterfall over
 * those facts, applied here in plain code — no AI involved, so
 * it can't drift, can't hallucinate a tier, and is fully unit
 * testable without ever calling the Groq API. See the bottom of
 * this file for the interpretation choices this encodes, since
 * a few points in the source doc were ambiguous.
 *
 * TUNABLE: the doc explicitly says this criteria "can be tweaked
 * based on Grant Team feedback" — that tuning should happen here,
 * in one place, not scattered across prompt text.
 * ============================================================
 */

const MATCH_LEVELS = ["HIGH", "GOOD", "OK", "NO"];

// Categorical fit score a grant with each tier maps to, for
// compatibility with the existing 1–5 fitScore used everywhere
// else in the app (tracker sort/filter, UI stars, minFitScore
// threshold). NO deliberately maps below CONFIG.qualification
// .minFitScore (default 2) so it's filtered out automatically.
const MATCH_LEVEL_TO_FIT_SCORE = { HIGH: 5, GOOD: 4, OK: 3, NO: 1 };

/**
 * Apply the ERE match-tier waterfall to AI-extracted facts about
 * one grant opportunity. Pure function — same input always gives
 * same output, independent of any AI call.
 *
 * @param {Object} facts
 * @param {"math_reading"|"general_tutoring"|"other_education"|"none"|"unclear"} facts.subjectMatch
 * @param {"7-12"|"k-12"|"other"|"unclear"} facts.gradeLevelMatch
 * @param {"tx_il"|"us"|"outside_us"|"unclear"} facts.geoMatch
 * @param {true|false|"unclear"} facts.nonprofitEligible
 * @returns {"HIGH"|"GOOD"|"OK"|"NO"}
 */
function deriveMatchLevel(facts) {
  const f = facts || {};

  // Nonprofit eligibility is a hard gate for every tier — "unclear"
  // is treated as failing it (conservative: don't rank a grant highly
  // when we're not sure ERE can even apply).
  const nonprofitOk = f.nonprofitEligible === true;
  if (!nonprofitOk) return "NO";

  const isMathReading = f.subjectMatch === "math_reading";
  const isTutoringAtAll = isMathReading || f.subjectMatch === "general_tutoring";

  const is7to12 = f.gradeLevelMatch === "7-12";
  const isK12OrNarrower = is7to12 || f.gradeLevelMatch === "k-12";

  const isTxIl = f.geoMatch === "tx_il";
  const isUsOrNarrower = isTxIl || f.geoMatch === "us";

  // HIGH — waterfall checked first per the doc.
  if (isMathReading && is7to12 && isTxIl) return "HIGH";

  // GOOD — broader grade range (K-12) and broader geography (US).
  if (isMathReading && isK12OrNarrower && isUsOrNarrower) return "GOOD";

  // OK — subject can be tutoring in general, not math/reading specifically.
  if (isTutoringAtAll && isK12OrNarrower && isUsOrNarrower) return "OK";

  // Everything else, including "unclear" facts that never satisfied
  // a tier above — falls to NO. Better to under-surface than to
  // rank an ambiguous grant as a good use of the Grant Team's time.
  return "NO";
}

/**
 * @param {"HIGH"|"GOOD"|"OK"|"NO"} level
 * @returns {number} 1–5, for compatibility with existing fitScore fields
 */
function matchLevelToFitScore(level) {
  return MATCH_LEVEL_TO_FIT_SCORE[level] ?? 1;
}

/**
 * Text block injected into the qualification system prompt,
 * telling the AI exactly which enum values to use for each fact
 * and nothing about tiers — the tier is never the AI's job.
 */
const MATCH_EXTRACTION_INSTRUCTIONS = `
Extract these FACTS about the grant — do not decide a tier, just report what you read:

subjectMatch — one of:
  "math_reading"     grant funds tutoring specifically in Math and/or Reading
  "general_tutoring" grant funds tutoring/tutoring programs/tutoring consulting, not specific to Math/Reading
  "other_education"  grant funds some other education service, not tutoring
  "none"             not education or tutoring related
  "unclear"          cannot tell from available information

gradeLevelMatch — one of:
  "7-12"    grant specifically targets students in roughly grades 7–12 (middle/high school)
  "k-12"    grant targets a broader K-12 range, not narrowly focused on 7-12
  "other"   targets grades entirely outside K-12 (e.g. pre-K only, college only)
  "unclear" cannot tell from available information

geoMatch — one of:
  "tx_il"      grant is explicitly eligible in Texas and/or Illinois (state-specific or narrower)
  "us"         grant is nationally open, not restricted to specific states other than TX/IL
  "outside_us" grant is restricted to a region that excludes the US
  "unclear"    cannot tell from available information

nonprofitEligible — true, false, or "unclear" — does the grant explicitly allow 501(c)(3) nonprofit applicants?
`.trim();

// ── Interpretation choices, since the source doc left some things
// ambiguous — documented here so the Grant Team can push back on
// any of these when tuning:
//
// 1. HIGH requires grade targeting to be SPECIFICALLY 7-12, not
//    merely a K-12 program that happens to include those grades.
//    A broad K-12 tutoring grant is GOOD, not HIGH, even though
//    grades 7-12 are technically served.
// 2. "Texas and Illinois" for HIGH is read as "either or both" —
//    a Texas-only or Illinois-only grant qualifies, not just grants
//    covering both states simultaneously.
// 3. "unclear" on any fact never promotes a grant above NO for that
//    criterion — ambiguous grants fall to the lowest tier rather
//    than being optimistically ranked higher.

// Node-only export for matchScoring.test.js — no effect in the
// browser (index.html loads this as a plain <script>, same as
// every other file in the app; this block never runs there).
if (typeof module !== "undefined" && module.exports) {
  module.exports = { deriveMatchLevel, matchLevelToFitScore, MATCH_EXTRACTION_INSTRUCTIONS, MATCH_LEVELS };
}
