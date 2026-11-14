// scripts/caster.mjs
// "Shoutcaster mode": turns the last year of contributions into an animated
// esports-broadcast SVG (live badge, match-replay grid, caster ticker).
// Writes caster.svg (light) and caster-dark.svg (dark) to the repo root.
//
//   GH_TOKEN=... node scripts/caster.mjs          real data
//   node scripts/caster.mjs --demo [outDir]       random data, no token needed
//
// Only daily counts are read; no repo names, so private work stays private.

import { writeFileSync } from "node:fs";
import { join } from "node:path";

const LOGIN = process.env.GITHUB_REPOSITORY_OWNER || "mochiicakes";
const NAME = "MOCHII";
const demo = process.argv.includes("--demo");
const outDir = process.argv.find((a, i) => i > 1 && !a.startsWith("--")) || ".";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const LEVELS = { NONE: 0, FIRST_QUARTILE: 1, SECOND_QUARTILE: 2, THIRD_QUARTILE: 3, FOURTH_QUARTILE: 4 };

const THEMES = {
  light: {
    bg: "#fff8fc", panel: "#ffffff", border: "#f1d6e8", text: "#4a3550", muted: "#9b86a3",
    cells: ["#f3e8f1", "#ffd1e8", "#ffa3cf", "#ff6fb0", "#e0408a"],
    accent: "#9d7cff", live: "#ff4d6d", ticker: "#2a1f33", tickerText: "#ffe3f1",
  },
  dark: {
    bg: "#0d1117", panel: "#161b22", border: "#30263a", text: "#f5e6f0", muted: "#a08aa8",
    cells: ["#1f2430", "#4a2a44", "#7a3a6a", "#c04f97", "#ff7fc0"],
    accent: "#b9a3ff", live: "#ff4d6d", ticker: "#ffc2e0", tickerText: "#2a1f33",
  },
};

async function fetchWeeks() {
  const token = process.env.GH_TOKEN;
  if (!token) throw new Error("GH_TOKEN is not set (or run with --demo)");
  const query = `query($login:String!){user(login:$login){contributionsCollection{contributionCalendar{
    totalContributions weeks{contributionDays{date contributionCount contributionLevel}}}}}}`;
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { Authorization: `bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables: { login: LOGIN } }),
  });
  const json = await res.json();
  if (!res.ok || json.errors) throw new Error(`GitHub API: ${JSON.stringify(json.errors || json)}`);
  return json.data.user.contributionsCollection.contributionCalendar.weeks.map((w) =>
    w.contributionDays.map((d) => ({ date: d.date, count: d.contributionCount, level: LEVELS[d.contributionLevel] ?? 0 })),
  );
}

function demoWeeks() {
  const weeks = [];
  const start = new Date(Date.UTC(2025, 10, 16));
  for (let w = 0; w < 53; w++) {
    const days = [];
    for (let d = 0; d < 7; d++) {
      const date = new Date(start.getTime() + (w * 7 + d) * 864e5);
      const count = Math.random() < 0.3 ? 0 : Math.floor(Math.random() ** 2 * 25);
      days.push({ date: date.toISOString().slice(0, 10), count, level: count === 0 ? 0 : Math.min(4, 1 + Math.floor(count / 6)) });
    }
    weeks.push(days);
  }
  return weeks;
}

function stats(weeks) {
  const days = weeks.flat();
  const total = days.reduce((s, d) => s + d.count, 0);
  const best = days.reduce((b, d) => (d.count > b.count ? d : b), days[0]);

  let longest = 0, run = 0;
  for (const d of days) { run = d.count > 0 ? run + 1 : 0; longest = Math.max(longest, run); }

  // current streak: today may still be empty, so start counting from yesterday in that case
  let i = days.length - 1;
  if (days[i].count === 0) i--;
  let current = 0;
  while (i >= 0 && days[i].count > 0) { current++; i--; }

  const byWeekday = Array(7).fill(0);
  const byMonth = Array(12).fill(0);
  for (const d of days) {
    const dt = new Date(d.date + "T00:00:00Z");
    byWeekday[dt.getUTCDay()] += d.count;
    byMonth[dt.getUTCMonth()] += d.count;
  }
  const powerDay = WEEKDAYS[byWeekday.indexOf(Math.max(...byWeekday))];
  const powerMonth = MONTHS[byMonth.indexOf(Math.max(...byMonth))];
  const activeDays = days.filter((d) => d.count > 0).length;
  return { total, best, longest, current, powerDay, powerMonth, activeDays, first: days[0].date, last: days.at(-1).date };
}

function prettyDate(iso) {
  const dt = new Date(iso + "T00:00:00Z");
  return `${WEEKDAYS[dt.getUTCDay()].toUpperCase()} ${MONTHS[dt.getUTCMonth()].toUpperCase()} ${dt.getUTCDate()}`;
}

const dayCount = (n) => `${n} DAY${n === 1 ? "" : "S"}`;

function casterLines(s) {
  const lines = [
    `AND ${NAME} DROPS ${s.best.count} COMMITS ON ${prettyDate(s.best.date)} -- WHAT A PLAY!!`,
    `${dayCount(s.longest)} STRAIGHT THIS SEASON -- THE BACKLOG CANNOT KEEP UP`,
    `${s.powerDay.toUpperCase()}S ARE ${NAME}'S POWER SPIKE`,
    `${s.powerMonth.toUpperCase()} WAS AN ABSOLUTE CLINIC`,
    s.current > 0
      ? `${dayCount(s.current)} AND COUNTING -- SOMEBODY CHECK ON THE KEYBOARD`
      : `TACTICAL PAUSE... READING DOCS, PLANNING THE NEXT PUSH`,
    `${s.total.toLocaleString("en-US")} CONTRIBUTIONS ACROSS ${s.activeDays} ACTIVE DAYS -- GG WP`,
  ];
  return lines.join("   ✧   ");
}

const esc = (t) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function render(weeks, s, t) {
  const CELL = 10, GAP = 3, STEP = CELL + GAP;
  const PAD = 20, GRID_X = PAD + 26, GRID_Y = 62;
  const W = GRID_X + weeks.length * STEP + PAD;
  const TICKER_Y = GRID_Y + 7 * STEP + 22;
  const H = TICKER_Y + 34 + PAD;
  const REVEAL = 3.2; // seconds for the "match replay" to sweep the grid

  const ticker = esc(casterLines(s));
  const tickerW = ticker.length * 7.25 + 40; // ~0.6em per monospace char at 12px
  const tickerDur = Math.round(tickerW / 55); // ~55px per second

  let cells = "", monthLabels = "", lastMonth = -1;
  weeks.forEach((week, w) => {
    const m = new Date(week[0].date + "T00:00:00Z").getUTCMonth();
    if (m !== lastMonth && w < weeks.length - 2) {
      monthLabels += `<text x="${GRID_X + w * STEP}" y="${GRID_Y - 8}" class="lbl">${MONTHS[m]}</text>`;
      lastMonth = m;
    }
    week.forEach((d) => {
      const row = new Date(d.date + "T00:00:00Z").getUTCDay();
      const x = GRID_X + w * STEP, y = GRID_Y + row * STEP;
      const delay = ((w / weeks.length) * REVEAL).toFixed(2);
      cells += `<rect class="c" x="${x}" y="${y}" width="${CELL}" height="${CELL}" rx="2.5" fill="${t.cells[d.level]}" style="animation-delay:${delay}s"><title>${d.count} on ${d.date}</title></rect>`;
      if (d.date === s.best.date) {
        cells += `<rect class="mvp" x="${x - 2.5}" y="${y - 2.5}" width="${CELL + 5}" height="${CELL + 5}" rx="4" fill="none" stroke="${t.accent}" stroke-width="2"/>`;
      }
    });
  });

  const dayLabels = [1, 3, 5].map((r) =>
    `<text x="${PAD}" y="${GRID_Y + r * STEP + CELL - 1}" class="lbl">${WEEKDAYS[r].slice(0, 3)}</text>`).join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${NAME} contribution graph as a live esports broadcast: ${s.total} contributions, best day ${s.best.count} on ${s.best.date}, longest streak ${s.longest} days">
<style>
  text { font-family: ui-monospace, "Cascadia Code", Consolas, Menlo, monospace; fill: ${t.text}; }
  .lbl { font-size: 9px; fill: ${t.muted}; }
  .hdr { font-size: 13px; font-weight: 700; letter-spacing: .5px; }
  .sub { font-size: 11px; fill: ${t.muted}; }
  .c { animation: pop .35s ease-out both; transform-box: fill-box; transform-origin: center; }
  @keyframes pop { 0% { opacity: 0; transform: scale(.2); } 70% { opacity: 1; transform: scale(1.25); } 100% { opacity: 1; transform: scale(1); } }
  .dot { animation: blink 1.2s steps(2, start) infinite; }
  @keyframes blink { to { visibility: hidden; } }
  .mvp { transform-box: fill-box; transform-origin: center; animation: mvp 1.6s ease-in-out ${REVEAL}s infinite; }
  @keyframes mvp { 0%,100% { opacity: .35; transform: scale(1); } 50% { opacity: 1; transform: scale(1.3); } }
  .tick { font-size: 12px; font-weight: 700; fill: ${t.tickerText}; animation: scroll ${tickerDur}s linear infinite; }
  @keyframes scroll { from { transform: translateX(${W - PAD * 2}px); } to { transform: translateX(-${Math.round(tickerW)}px); } }
  @media (prefers-reduced-motion: reduce) { .c, .mvp, .tick, .dot { animation: none; } }
</style>
<rect width="${W}" height="${H}" rx="14" fill="${t.bg}" stroke="${t.border}"/>

<g transform="translate(${PAD} 18)">
  <rect width="54" height="20" rx="4" fill="${t.live}"/>
  <circle class="dot" cx="11" cy="10" r="4" fill="#fff"/>
  <text x="20" y="14.5" style="font-size:11px;font-weight:800;fill:#fff">LIVE</text>
  <text x="66" y="14.5" class="hdr">${NAME} vs. THE BACKLOG</text>
</g>
<text x="${W - PAD}" y="32" text-anchor="end" class="sub">SEASON ${s.first.slice(0, 4)}-${s.last.slice(0, 4)} · ${s.total.toLocaleString("en-US")} CONTRIBS · MVP DAY <tspan style="fill:${t.accent};font-weight:700">${s.best.count}</tspan></text>

${monthLabels}${dayLabels}
${cells}

<clipPath id="tk"><rect x="${PAD}" y="${TICKER_Y}" width="${W - PAD * 2}" height="30" rx="7"/></clipPath>
<rect x="${PAD}" y="${TICKER_Y}" width="${W - PAD * 2}" height="30" rx="7" fill="${t.ticker}"/>
<g clip-path="url(#tk)">
  <text class="tick" x="${PAD + 12}" y="${TICKER_Y + 19.5}">\u{1F399} ${ticker}</text>
</g>
</svg>
`;
}

const weeks = demo ? demoWeeks() : await fetchWeeks();
const s = stats(weeks);
writeFileSync(join(outDir, "caster.svg"), render(weeks, s, THEMES.light));
writeFileSync(join(outDir, "caster-dark.svg"), render(weeks, s, THEMES.dark));
console.log(`caster: ${s.total} contributions, best ${s.best.count} on ${s.best.date}, longest streak ${s.longest}`);
