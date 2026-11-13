// Node-only loader for the V2 rules (the browser fetches the same files).
import { readFileSync } from "node:fs";
import { prepare } from "./engine.js";

const read = (n) => JSON.parse(readFileSync(new URL(`../rules/v2/${n}.json`, import.meta.url), "utf8"));
const strip = (o) => Object.fromEntries(Object.entries(o).filter(([k]) => !k.startsWith("_")));

export function loadData() {
  return prepare({ config: read("config"), cards: strip(read("cards")), fighters: strip(read("fighters")), tactics: read("tactics") });
}
