import { openDb } from "../lib/db";
import { seedSmartWallets, getAllSmartTags } from "../lib/smartWallets";
const db = openDb("/tmp/smoke-seed.sqlite");
const r = await seedSmartWallets(db, { periods: ["WEEK"], perPeriod: 50, enrichTop: 5 });
console.log("seed result:", r);
const tags = getAllSmartTags(db);
console.log("total in table:", tags.size);
const top = [...tags.entries()].sort((a, b) => (b[1].score ?? 0) - (a[1].score ?? 0)).slice(0, 5);
for (const [w, t] of top) console.log(w.slice(0, 10), "score=", t.score, "winRate=", t.winRate?.toFixed(2), "pnl=", Math.round(t.realizedPnl ?? 0));
