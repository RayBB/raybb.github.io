#!/usr/bin/env node

/**
 * update-wikipedia.mjs
 *
 * Fetches Wikipedia pages created by a given user, compares against the
 * existing data in src/data/wikipedia.json, and appends any new articles
 * (with their extracts).  Run with --dry-run to preview what would be added.
 *
 * Usage:
 *   node scripts/update-wikipedia.mjs <username>           # real run
 *   node scripts/update-wikipedia.mjs <username> --dry-run # preview only
 */

import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_PATH = join(__dirname, "..", "src", "data", "wikipedia.json");
const API = "https://en.wikipedia.org/w/api.php";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function apiFetch(params) {
  const url = new URL(API);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  url.searchParams.set("format", "json");
  url.searchParams.set("origin", "*");

  const res = await fetch(url);
  if (!res.ok) throw new Error(`API error ${res.status}: ${res.statusText}`);

  const data = await res.json();
  if (data?.error) throw new Error(`API error: ${data.error.code} — ${data.error.info}`);
  return data;
}

/** Fetch *all* page-creations (ucshow=new) for a user in the main (article)
 *  namespace (namespace 0), following continuation. */
async function fetchAllCreations(username) {
  const pages = [];
  let continueToken = null;

  do {
    const params = {
      action: "query",
      list: "usercontribs",
      ucuser: username,
      ucshow: "new",
      ucnamespace: "0",
      ucprop: "title|timestamp",
      uclimit: "500",
    };
    if (continueToken) params.uccontinue = continueToken;

    const data = await apiFetch(params);
    const contribs = data?.query?.usercontribs ?? [];
    for (const c of contribs) {
      pages.push({ title: c.title });
    }
    continueToken = data?.continue?.uccontinue;
  } while (continueToken);

  return pages;
}

/**
 * Given a list of page titles, query their metadata to determine which are
 * actual articles (not redirects, not disambiguation pages, not deleted).
 * Returns a filtered array of { title } objects.
 */
async function filterArticles(pages) {
  const results = [];

  for (let i = 0; i < pages.length; i += 50) {
    const batch = pages.slice(i, i + 50).map((p) => p.title);
    const data = await apiFetch({
      action: "query",
      titles: batch.join("|"),
      prop: "info|pageprops",
    });

    // Titles that were redirected are in the redirects array
    const redirects = data?.query?.redirects ?? [];
    const redirectedFrom = new Set(redirects.map((r) => r.from));

    const qPages = data?.query?.pages ?? {};

    for (const queryTitle of batch) {
      // This title was resolved as a redirect → skip it
      if (redirectedFrom.has(queryTitle)) continue;

      // Find the page entry for this title
      const page = Object.values(qPages).find((p) => p.title === queryTitle);

      // Page was deleted since creation
      if (!page || page.missing) continue;

      // The API might return the redirect page with a `redirect` property
      // (empty string) instead of resolving it. Skip these too.
      if (page.redirect !== undefined) continue;

      // Disambiguation page
      if (page.pageprops?.disambiguation !== undefined) continue;

      results.push({ title: queryTitle });
    }
  }

  return results;
}

/** Fetch extracts for a batch of titles (wiki-encoded pipe-separated). */
async function fetchExtracts(titles) {
  if (titles.length === 0) return {};

  const data = await apiFetch({
    action: "query",
    titles: titles.join("|"),
    prop: "extracts",
    exintro: "1",
    exlimit: Math.min(titles.length, 50).toString(),
  });

  const map = {};
  const pages = data?.query?.pages ?? {};
  for (const id of Object.keys(pages)) {
    if (id === "-1") continue; // missing page
    const p = pages[id];
    map[p.title] = (p.extract || "").trim();
  }
  return map;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const username = process.argv[2];
  const dryRun = process.argv.includes("--dry-run");

  if (!username) {
    console.error("Usage: node scripts/update-wikipedia.mjs <wikipedia-username> [--dry-run]");
    process.exit(1);
  }

  // 1. Load existing data
  let existing = [];
  try {
    existing = JSON.parse(readFileSync(DATA_PATH, "utf-8"));
  } catch {
    console.warn("⚠  No existing data file found – starting fresh.");
  }
  const existingTitles = new Set(existing.map((a) => a.title));

  // 2. Fetch created pages from Wikipedia
  console.log(`🔍 Fetching pages created by "${username}"…`);
  const created = await fetchAllCreations(username);
  console.log(`   Found ${created.length} total page creation(s).`);

  // 3. Identify new (not yet tracked) articles
  const candidatePages = created.filter((p) => !existingTitles.has(p.title));
  console.log(`   ${candidatePages.length} new page(s) not yet in the data file.`);

  if (candidatePages.length === 0) {
    console.log("✅ Everything is up to date.");
    return;
  }

  // 4. Filter out redirects, disambiguation pages, and deleted pages
  console.log(`   Checking for redirects, disambiguation pages, etc…`);
  const newPages = await filterArticles(candidatePages);
  const skipped = candidatePages.length - newPages.length;
  console.log(`   ${newPages.length} actual article(s) remain (${skipped} skipped).\n`);

  if (newPages.length === 0) {
    console.log("✅ No new articles to add (all candidates were redirects or disambiguation pages).");
    return;
  }

  // 5. Fetch extracts for new articles (in batches of 50)
  const batchSize = 50;
  let allExtracts = {};
  for (let i = 0; i < newPages.length; i += batchSize) {
    const batch = newPages.slice(i, i + batchSize).map((p) => p.title);
    console.log(`   Fetching extracts (batch ${Math.floor(i / batchSize) + 1} of ${Math.ceil(newPages.length / batchSize)})…`);
    const extracts = await fetchExtracts(batch);
    allExtracts = { ...allExtracts, ...extracts };
  }

  // 5. Build new article entries
  const newArticles = newPages.map((p) => ({
    title: p.title,
    extract: allExtracts[p.title] || "",
    url: `https://en.wikipedia.org/wiki/${encodeURIComponent(p.title.replace(/ /g, "_"))}`,
    tags: [],
  }));

  // 6. Report
  console.log(`\n📋 Would add ${newArticles.length} new article(s):`);
  for (const a of newArticles) {
    const hasExtract = a.extract ? "✓" : " ";
    console.log(`   [${hasExtract}] ${a.title}`);
  }

  // 7. Write (unless dry-run)
  if (dryRun) {
    console.log("\n🔶 Dry-run – no changes written.");
  } else {
    const merged = [...existing, ...newArticles];
    writeFileSync(DATA_PATH, JSON.stringify(merged, null, 2) + "\n", "utf-8");
    console.log(`\n✅ Wrote ${merged.length} articles to ${DATA_PATH.replace(__dirname, "..")}`);
  }
}

main().catch((err) => {
  console.error("❌", err);
  process.exit(1);
});
