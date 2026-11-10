// Node-only loader for the battlegrounds-mode rules (the browser fetches the same files).
import { readFileSync } from "node:fs";
import { prepare } from "./engine.js";

const read = (n) => JSON.parse(readFileSync(new URL(`../rules/bg/${n}.json`, import.meta.url), "utf8"));
const strip = (o) => Object.fromEntries(Object.entries(o).filter(([k]) => !k.startsWith("_")));
export const loadData = () => prepare({ config: read("config"), skills: strip(read("skills")), fighters: strip(read("fighters")) });
