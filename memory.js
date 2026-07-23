/**
 * ============================================================
 * memory.js — Search Memory & Deduplication Layer
 * AI-Powered Grant Discovery System
 * Version: 1.0 | July 2026
 *
 * WHAT THIS FILE DOES:
 * Maintains three persistent lists across all weekly runs so
 * the system gets smarter every week and never wastes tokens
 * re-searching what it already knows.
 *
 * THREE MEMORY LISTS:
 *
 *   LIST 1 — KNOWN FUNDERS
 *   Every funder ever added to the tracker.
 *   Injected into the discovery prompt as the exclude list.
 *   Groq never searches for these again.
 *   Source: tracker.js calls addKnownFunder() on every add.
 *
 *   LIST 2 — DEAD URLS
 *   Every URL that returned DEAD, LOGIN_WALL, or NEEDS_CHECK
 *   during link verification (Layer 1.5).
 *   Groq never visits these again.
 *   Auto-purged after DEAD_URL_TTL_DAYS (default 60 days)
 *   in case a dead page comes back to life.
 *
 *   LIST 3 — VERIFIED DOMAINS
 *   Every domain that passed link verification.
 *   Stores date last verified.
 *   Re-verification skipped if verified within
 *   VERIFIED_DOMAIN_TTL_DAYS (default 30 days).
 *   This saves tokens on known-good grant pages.
 *
 * STORAGE:
 *   Uses localStorage as primary (always available, no async).
 *   Falls back gracefully if storage is unavailable.
 *   All three lists are stored under separate keys.
 *   Total storage footprint: < 50KB for a year of weekly runs.
 *
 * HOW IT CONNECTS TO OTHER FILES:
 *   config.js         → storage key names defined in CONFIG
 *   discovery.js      → calls getExcludeList() to build prompt
 *   linkVerification.js → calls isDeadUrl(), markUrlDead(),
 *                         isRecentlyVerified(), markDomainVerified()
 *   tracker.js        → calls addKnownFunder() on every tracker add
 *   index.html        → calls getMemoryStats() for Settings tab display
 *
 * DEPENDENCIES:
 *   config.js must be loaded first (today(), esc())
 * ============================================================
 */


// ============================================================
// STORAGE KEYS
// All memory stored under these localStorage keys.
// Defined here (not in config.js) to keep memory self-contained.
// ============================================================

const MEMORY_KEYS = {
  knownFunders:     "ere-memory-known-funders",
  deadUrls:         "ere-memory-dead-urls",
  verifiedDomains:  "ere-memory-verified-domains",
  runHistory:       "ere-memory-run-history",
};

// ============================================================
// TTL CONSTANTS
// How long before we re-check a dead or verified URL.
// ============================================================

const DEAD_URL_TTL_DAYS      = 60;  // Re-check dead URLs after 60 days
const KNOWN_FUNDER_TTL_DAYS    = 30;  // Auto-purge known funders after 30 days — fresh cycle every month
                                     // (page may have come back to life)
const VERIFIED_DOMAIN_TTL_DAYS = 30; // Re-verify domains after 30 days
                                     // (grant cycle may have closed)
const RUN_HISTORY_MAX        = 52;  // Keep last 52 runs (one year weekly)


// ============================================================
// INTERNAL STORAGE HELPERS
// Simple localStorage read/write with JSON parsing.
// These are synchronous — no async needed for localStorage.
// ============================================================

/**
 * Read a memory list from localStorage.
 * Returns empty object/array if key doesn't exist or parse fails.
 * @param {string} key   localStorage key
 * @param {*}      def   default value if key missing
 * @returns {*}
 */
function memRead(key, def = {}) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return def;
    return JSON.parse(raw);
  } catch (e) {
    console.warn(`memory.js: could not read "${key}":`, e.message);
    return def;
  }
}

/**
 * Write a value to localStorage as JSON.
 * Silently ignores write failures (e.g. private browsing quotas).
 * @param {string} key    localStorage key
 * @param {*}      value  value to store
 */
function memWrite(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.warn(`memory.js: could not write "${key}":`, e.message);
  }
}

/**
 * Extract the domain from a URL string.
 * e.g. "https://www.cct.org/grants/" → "cct.org"
 * Used to deduplicate at domain level, not full URL level.
 * @param {string} url
 * @returns {string}  lowercase domain without www
 */
function extractDomain(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, "").toLowerCase();
  } catch (_) {
    // Not a valid URL — return the raw string lowercased
    return (url || "").toLowerCase().replace(/^https?:\/\/(www\.)?/, "");
  }
}

/**
 * Check whether a date string is older than N days from today.
 * @param {string} dateStr  ISO date string (YYYY-MM-DD)
 * @param {number} days
 * @returns {boolean}
 */
function isOlderThan(dateStr, days) {
  if (!dateStr) return true; // No date = treat as expired
  const d = new Date(dateStr);
  if (isNaN(d)) return true;
  const age = Math.floor((new Date(today()) - d) / 86400000);
  return age > days;
}


// ============================================================
// LIST 1 — KNOWN FUNDERS
// ============================================================
// Shape stored in localStorage:
// {
//   "Chicago Community Trust": {
//     addedDate: "2026-07-08",
//     source:    "tracker",   // how it was added
//     status:    "Pursue",  // last known tracker status
//   },
//   ...
// }
// ============================================================

/**
 * Load the full known funders map.
 * @returns {Object}  { funderName: { addedDate, source, status } }
 */
function loadKnownFunders() {
  const known = memRead(MEMORY_KEYS.knownFunders, {});

  // Auto-purge entries older than KNOWN_FUNDER_TTL_DAYS (30 days)
  // Funders discovered in previous cycles can be rediscovered after 30 days
  let purged = false;
  for (const [key, entry] of Object.entries(known)) {
    // Only auto-purge entries added by discovery — never purge manually tracked funders
    if (entry.source === 'auto' && isOlderThan(entry.addedDate, KNOWN_FUNDER_TTL_DAYS)) {
      delete known[key];
      purged = true;
    }
  }
  if (purged) memWrite(MEMORY_KEYS.knownFunders, known);

  return known;
}

/**
 * Add a funder to the known funders list.
 * Called by tracker.js every time an opportunity is added to tracker.
 * Idempotent — safe to call multiple times for the same funder.
 *
 * @param {string} funderName   funder name from opportunity
 * @param {string} status       current tracker status (e.g. "Pursue")
 * @param {string} source       how it was added ("tracker" | "manual")
 */
function addKnownFunder(funderName, status = "New", source = "tracker") {
  if (!funderName || !funderName.trim()) return;
  const known = loadKnownFunders();
  const key   = funderName.trim();

  // Update status if already known, otherwise add fresh entry
  known[key] = {
    addedDate: known[key]?.addedDate || today(),
    updatedDate: today(),
    source,
    status,
  };

  memWrite(MEMORY_KEYS.knownFunders, known);
}

/**
 * Update the status of a known funder when tracker status changes.
 * Called by tracker.js when the Status column is edited.
 * @param {string} funderName
 * @param {string} newStatus
 */
function updateKnownFunderStatus(funderName, newStatus) {
  if (!funderName) return;
  const known = loadKnownFunders();
  const key   = funderName.trim();
  if (known[key]) {
    known[key].status      = newStatus;
    known[key].updatedDate = today();
    memWrite(MEMORY_KEYS.knownFunders, known);
  }
}

/**
 * Remove a funder from the known list.
 * Called if a tracker row is deleted — allows rediscovery.
 * @param {string} funderName
 */
function removeKnownFunder(funderName) {
  if (!funderName) return;
  const known = loadKnownFunders();
  delete known[funderName.trim()];
  memWrite(MEMORY_KEYS.knownFunders, known);
}

/**
 * Get the exclude list as a formatted string for the discovery prompt.
 * Returns all known funder names, comma-separated.
 * Also merges any manual exclusions from the org profile.
 *
 * @param {string} profileExclude  profile.excludeFunders string
 * @returns {string}  comma-separated list for injection into prompt
 */
function getExcludeList(profileExclude = "") {
  const known = loadKnownFunders();
  const fromMemory = Object.keys(known);

  // Parse manual exclusions from the profile field
  const fromProfile = (profileExclude || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  // Merge and deduplicate (case-insensitive)
  const seen = new Set();
  const merged = [...fromMemory, ...fromProfile].filter((name) => {
    const lower = name.toLowerCase();
    if (seen.has(lower)) return false;
    seen.add(lower);
    return true;
  });

  return merged.join(", ");
}

/**
 * Get count of known funders for the UI stats display.
 * @returns {number}
 */
function getKnownFunderCount() {
  return Object.keys(loadKnownFunders()).length;
}


// ============================================================
// LIST 2 — DEAD URLS
// ============================================================
// Shape stored in localStorage:
// {
//   "https://www.example.org/closed-grants": {
//     markedDate:  "2026-07-08",
//     reason:      "DEAD",        // DEAD | LOGIN_WALL | NEEDS_CHECK
//     funder:      "Example Org", // for display in Settings
//     expiresDate: "2026-09-06",  // auto-rechecked after TTL
//   },
//   ...
// }
// ============================================================

/**
 * Load the full dead URLs map.
 * @returns {Object}  { url: { markedDate, reason, funder, expiresDate } }
 */
function loadDeadUrls() {
  return memRead(MEMORY_KEYS.deadUrls, {});
}

/**
 * Check whether a URL is known-dead and still within TTL.
 * Returns true if the URL should be SKIPPED by link verification.
 * Returns false if the URL is not known-dead OR if TTL has expired
 * (meaning it should be re-checked).
 *
 * @param {string} url
 * @returns {boolean}  true = skip this URL, false = check it
 */
function isDeadUrl(url) {
  if (!url) return false;
  const dead = loadDeadUrls();
  const entry = dead[url.trim()];
  if (!entry) return false;

  // TTL expired — remove from dead list so it gets re-checked
  if (isOlderThan(entry.markedDate, DEAD_URL_TTL_DAYS)) {
    removeDeadUrl(url);
    return false; // re-check it
  }

  return true; // still dead within TTL — skip
}

/**
 * Mark a URL as dead/unverifiable.
 * Called by linkVerification.js when a URL fails verification.
 *
 * @param {string} url     the URL that failed
 * @param {string} reason  "DEAD" | "LOGIN_WALL" | "NEEDS_CHECK"
 * @param {string} funder  funder name for display purposes
 */
function markUrlDead(url, reason = "DEAD", funder = "") {
  if (!url) return;
  const dead = loadDeadUrls();
  const key  = url.trim();

  const expiresDate = new Date(today());
  expiresDate.setDate(expiresDate.getDate() + DEAD_URL_TTL_DAYS);

  dead[key] = {
    markedDate:  today(),
    reason,
    funder:      funder.trim(),
    expiresDate: expiresDate.toISOString().split("T")[0],
  };

  memWrite(MEMORY_KEYS.deadUrls, dead);
}

/**
 * Remove a URL from the dead list.
 * Called when TTL expires so the URL gets re-checked.
 * @param {string} url
 */
function removeDeadUrl(url) {
  if (!url) return;
  const dead = loadDeadUrls();
  delete dead[url.trim()];
  memWrite(MEMORY_KEYS.deadUrls, dead);
}

/**
 * Filter an opportunities array, removing any with known-dead URLs.
 * Called at the START of link verification to skip dead URLs.
 *
 * @param {Array} opportunities
 * @returns {Object}  { toVerify: [], skipped: [] }
 *   toVerify = opportunities that need verification
 *   skipped  = opportunities whose URL is known-dead (dropped)
 */
function filterDeadUrls(opportunities) {
  const toVerify = [];
  const skipped  = [];

  opportunities.forEach((opp) => {
    if (isDeadUrl(opp.url)) {
      console.info(
        `memory.js: skipping known-dead URL for "${opp.funder}": ${opp.url}`
      );
      skipped.push({
        ...opp,
        linkStatus:   "DEAD",
        finalUrl:     opp.url,
        pageTitle:    null,
        keywordsFound: [],
        dateVerified: today(),
        skippedByMemory: true,
      });
    } else {
      toVerify.push(opp);
    }
  });

  return { toVerify, skipped };
}

/**
 * Get count of active dead URLs for the UI stats display.
 * Only counts non-expired entries.
 * @returns {number}
 */
function getDeadUrlCount() {
  const dead = loadDeadUrls();
  return Object.values(dead).filter(
    (entry) => !isOlderThan(entry.markedDate, DEAD_URL_TTL_DAYS)
  ).length;
}


// ============================================================
// LIST 3 — VERIFIED DOMAINS
// ============================================================
// Shape stored in localStorage:
// {
//   "cct.org": {
//     lastVerified: "2026-07-08",
//     pageTitle:    "Chicago Community Trust — Grants",
//     funder:       "Chicago Community Trust",
//   },
//   ...
// }
// ============================================================

/**
 * Load the full verified domains map.
 * @returns {Object}  { domain: { lastVerified, pageTitle, funder } }
 */
function loadVerifiedDomains() {
  return memRead(MEMORY_KEYS.verifiedDomains, {});
}

/**
 * Check whether a URL's domain was recently verified.
 * "Recently" = within VERIFIED_DOMAIN_TTL_DAYS (default 30 days).
 * If true, link verification can skip this URL and reuse the
 * cached verification result.
 *
 * @param {string} url
 * @returns {Object|null}
 *   null = not recently verified, needs checking
 *   Object = { lastVerified, pageTitle, funder } — cached result
 */
function isRecentlyVerified(url) {
  if (!url) return null;
  const domain  = extractDomain(url);
  const domains = loadVerifiedDomains();
  const entry   = domains[domain];
  if (!entry) return null;

  if (isOlderThan(entry.lastVerified, VERIFIED_DOMAIN_TTL_DAYS)) {
    // TTL expired — remove and re-verify
    removeVerifiedDomain(domain);
    return null;
  }

  return entry; // fresh cached verification
}

/**
 * Mark a domain as verified after successful link verification.
 * Called by linkVerification.js for every VERIFIED or REDIRECTS result.
 *
 * @param {string} url        the original or final URL
 * @param {string} pageTitle  page title from the visit
 * @param {string} funder     funder name for display
 */
function markDomainVerified(url, pageTitle = "", funder = "") {
  if (!url) return;
  const domain  = extractDomain(url);
  const domains = loadVerifiedDomains();

  domains[domain] = {
    lastVerified: today(),
    pageTitle:    pageTitle.trim(),
    funder:       funder.trim(),
  };

  memWrite(MEMORY_KEYS.verifiedDomains, domains);
}

/**
 * Remove a domain from the verified list (TTL expired).
 * @param {string} domain  bare domain string (not full URL)
 */
function removeVerifiedDomain(domain) {
  if (!domain) return;
  const domains = loadVerifiedDomains();
  delete domains[domain];
  memWrite(MEMORY_KEYS.verifiedDomains, domains);
}

/**
 * Filter opportunities array against recently-verified domains.
 * Splits into two groups:
 *   alreadyVerified = domain verified within TTL — skip re-check,
 *                     attach cached pageTitle, mark VERIFIED
 *   needsChecking   = domain not recently verified — must visit
 *
 * @param {Array} opportunities  array from filterDeadUrls().toVerify
 * @returns {Object}  { alreadyVerified: [], needsChecking: [] }
 */
function filterRecentlyVerified(opportunities) {
  const alreadyVerified = [];
  const needsChecking   = [];

  opportunities.forEach((opp) => {
    const cached = isRecentlyVerified(opp.url);
    if (cached) {
      console.info(
        `memory.js: "${opp.funder}" domain verified ${cached.lastVerified} — skipping re-check`
      );
      alreadyVerified.push({
        ...opp,
        linkStatus:    "VERIFIED",
        finalUrl:      opp.url,
        pageTitle:     cached.pageTitle || opp.funder,
        keywordsFound: [],
        dateVerified:  cached.lastVerified,
        cachedByMemory: true,
      });
    } else {
      needsChecking.push(opp);
    }
  });

  return { alreadyVerified, needsChecking };
}

/**
 * Get count of verified domains for the UI stats display.
 * @returns {number}
 */
function getVerifiedDomainCount() {
  return Object.keys(loadVerifiedDomains()).length;
}


// ============================================================
// RUN HISTORY
// ============================================================
// Logs a summary of each weekly run for the Settings tab.
// Keeps last RUN_HISTORY_MAX entries (default 52 = one year).
//
// Shape stored in localStorage:
// [
//   {
//     runDate:       "2026-07-08",
//     discovered:    8,
//     verified:      5,
//     dropped:       3,
//     qualified:     4,
//     addedToTracker: 3,
//     skippedByMemory: 2,
//     newFundersFound: 4,
//   },
//   ...
// ]
// ============================================================

/**
 * Load the run history array.
 * @returns {Array}
 */
function loadRunHistory() {
  return memRead(MEMORY_KEYS.runHistory, []);
}

/**
 * Log a completed run to history.
 * Called by index.html at the end of a full pipeline run.
 *
 * @param {Object} runSummary
 *   { discovered, verified, dropped, qualified, addedToTracker,
 *     skippedByMemory, newFundersFound }
 */
function logRun(runSummary) {
  const history = loadRunHistory();

  history.unshift({
    runDate: today(),
    ...runSummary,
  });

  // Keep only the most recent RUN_HISTORY_MAX entries
  if (history.length > RUN_HISTORY_MAX) {
    history.splice(RUN_HISTORY_MAX);
  }

  memWrite(MEMORY_KEYS.runHistory, history);
}

/**
 * Get the date of the last run for display in the Settings tab.
 * @returns {string}  ISO date string or "Never"
 */
function getLastRunDate() {
  const history = loadRunHistory();
  if (!history.length) return "Never";
  return history[0].runDate;
}


// ============================================================
// MEMORY STATS
// Single object with all counts — used by the Settings tab
// to show the ERE founder how the system is learning.
// ============================================================

/**
 * Get a summary of all memory lists for display.
 * Called by index.html to populate the Memory Stats panel.
 *
 * @returns {Object}
 */
function getMemoryStats() {
  const history = loadRunHistory();
  const known   = loadKnownFunders();

  return {
    knownFunderCount:    getKnownFunderCount(),
    deadUrlCount:        getDeadUrlCount(),
    verifiedDomainCount: getVerifiedDomainCount(),
    totalRunCount:       history.length,
    lastRunDate:         getLastRunDate(),
    deadUrlTtlDays:      DEAD_URL_TTL_DAYS,
    verifiedTtlDays:     VERIFIED_DOMAIN_TTL_DAYS,

    // Recent run history for sparkline-style display
    recentRuns: history.slice(0, 10).map((r) => ({
      date:      r.runDate,
      found:     r.discovered   || 0,
      verified:  r.verified     || 0,
      added:     r.addedToTracker || 0,
      skipped:   r.skippedByMemory || 0,
    })),

    // Known funders with their current status — for display
    knownFunders: Object.entries(known)
      .sort((a, b) => b[1].addedDate?.localeCompare(a[1].addedDate))
      .slice(0, 20) // Show most recent 20
      .map(([name, data]) => ({
        name,
        status:    data.status    || "Unknown",
        addedDate: data.addedDate || "—",
      })),
  };
}


// ============================================================
// MEMORY RESET
// Lets the ERE founder clear individual lists or all memory.
// Exposed to the Settings tab UI.
// ============================================================

/**
 * Clear all memory lists.
 * USE WITH CAUTION — next run starts from scratch.
 * Prompts for confirmation before executing.
 */
function clearAllMemory() {
  Object.values(MEMORY_KEYS).forEach((key) => {
    localStorage.removeItem(key);
  });
  console.info("memory.js: all memory cleared");
  showToast("Memory cleared. Next search starts fresh.");
}

/**
 * Clear only the dead URLs list.
 * Useful if a funder has relaunched their grants page.
 */
function clearDeadUrls() {
  localStorage.removeItem(MEMORY_KEYS.deadUrls);
  showToast("Dead URL list cleared. All URLs will be re-checked.");
}

/**
 * Clear only the verified domains cache.
 * Forces full re-verification on next run.
 */
function clearVerifiedDomains() {
  localStorage.removeItem(MEMORY_KEYS.verifiedDomains);
  showToast("Verified domains cleared. All pages will be re-verified.");
}

/**
 * Remove a single funder from the known list.
 * Allows rediscovery of a funder that was accidentally added.
 * @param {string} funderName
 */
function forgetFunder(funderName) {
  removeKnownFunder(funderName);
  showToast(`"${funderName}" removed from known funders. Will appear in next search.`);
}


// ============================================================
// RENDER MEMORY STATS PANEL
// Renders the memory status panel in the Settings tab.
// ============================================================

/**
 * Render the memory stats panel in the Settings tab.
 * Called by index.html when the Settings tab is opened.
 */
function renderMemoryStats() {
  const el = document.getElementById("memory-stats");
  if (!el) return;

  const stats = getMemoryStats();

  const knownFunderRows = stats.knownFunders.length
    ? stats.knownFunders
        .map(
          (f) => `
          <tr>
            <td>${esc(f.name)}</td>
            <td><span class="pill ${statusPillClass(f.status)}">${esc(f.status)}</span></td>
            <td class="mono" style="color:var(--muted);">${esc(f.addedDate)}</td>
            <td>
              <button class="btn btn-ghost btn-sm"
                onclick="forgetFunder('${esc(f.name)}')"
                title="Remove from known list — allows rediscovery">
                Forget
              </button>
            </td>
          </tr>`
        )
        .join("")
    : `<tr><td colspan="4" style="color:var(--muted);text-align:center;padding:16px;">
         No funders tracked yet. Run a discovery search to get started.
       </td></tr>`;

  const recentRunRows = stats.recentRuns.length
    ? stats.recentRuns
        .map(
          (r) => `
          <tr>
            <td class="mono">${esc(r.date)}</td>
            <td>${esc(String(r.found))}</td>
            <td>${esc(String(r.verified))}</td>
            <td>${esc(String(r.added))}</td>
            <td style="color:var(--muted);">${esc(String(r.skipped))} saved</td>
          </tr>`
        )
        .join("")
    : `<tr><td colspan="5" style="color:var(--muted);text-align:center;padding:16px;">
         No runs logged yet.
       </td></tr>`;

  el.innerHTML = `

    <!-- Stat cards -->
    <div class="summary-strip" style="margin-bottom:var(--gap-lg);">
      <div class="stat-card">
        <div class="stat-number">${esc(String(stats.knownFunderCount))}</div>
        <div class="stat-label">Known funders</div>
      </div>
      <div class="stat-card">
        <div class="stat-number">${esc(String(stats.deadUrlCount))}</div>
        <div class="stat-label">Dead URLs cached</div>
      </div>
      <div class="stat-card">
        <div class="stat-number">${esc(String(stats.verifiedDomainCount))}</div>
        <div class="stat-label">Verified domains</div>
      </div>
      <div class="stat-card">
        <div class="stat-number">${esc(String(stats.totalRunCount))}</div>
        <div class="stat-label">Total runs</div>
      </div>
      <div class="stat-card">
        <div class="stat-number mono" style="font-size:14px;">${esc(stats.lastRunDate)}</div>
        <div class="stat-label">Last run</div>
      </div>
    </div>

    <!-- How memory works -->
    <div class="api-note" style="margin-bottom:var(--gap-lg);">
      <b>How memory works:</b>
      Known funders are excluded from every future search — Groq never searches for them again.
      Dead URLs are skipped for ${esc(String(stats.deadUrlTtlDays))} days then re-checked automatically.
      Verified domains skip re-verification for ${esc(String(stats.verifiedTtlDays))} days to save tokens.
      Every weekly run gets smarter than the last.
    </div>

    <!-- Recent runs table -->
    <h4 style="margin:0 0 var(--gap-sm) 0;">Recent runs</h4>
    <div class="tracker-wrap" style="margin-bottom:var(--gap-lg);">
      <table>
        <thead>
          <tr>
            <th>Date</th><th>Found</th><th>Verified</th>
            <th>Added</th><th>Token savings</th>
          </tr>
        </thead>
        <tbody>${recentRunRows}</tbody>
      </table>
    </div>

    <!-- Known funders table -->
    <div class="flex-between" style="margin-bottom:var(--gap-sm);">
      <h4 style="margin:0;">Known funders (excluded from future searches)</h4>
      <button class="btn btn-ghost btn-sm"
        onclick="if(confirm('Remove ALL known funders? Next search will find them again.')) { clearAllMemory(); renderMemoryStats(); }">
        Reset all memory
      </button>
    </div>
    <div class="tracker-wrap" style="margin-bottom:var(--gap-md);">
      <table>
        <thead>
          <tr>
            <th>Funder</th><th>Tracker status</th><th>Added</th><th></th>
          </tr>
        </thead>
        <tbody>${knownFunderRows}</tbody>
      </table>
    </div>

    <!-- Reset buttons -->
    <div class="btn-row">
      <button class="btn btn-ghost btn-sm"
        onclick="clearDeadUrls(); renderMemoryStats();">
        Re-check all dead URLs
      </button>
      <button class="btn btn-ghost btn-sm"
        onclick="clearVerifiedDomains(); renderMemoryStats();">
        Force re-verify all domains
      </button>
    </div>`;
}

/**
 * Helper: map tracker status to a pill CSS class.
 * Duplicated here to avoid dependency on tracker.js load order.
 * @param {string} status
 * @returns {string}  CSS class
 */
function statusPillClass(status) {
  const map = {
    "Funded":      "pill-pass",
    "Pursue":      "pill-soon",
    "Submitted":   "pill-rolling",
    "Declined":    "pill-verify",
    "Not Eligible":"pill-verify",
    "Defer":       "pill-verify",
    "New":         "pill-open",
  };
  return map[normaliseLegacyStatus(status)] || "pill-open";
}
