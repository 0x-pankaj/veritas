import { startSeller, type RunningSeller } from "./run-seller.js";
import { SELLER_DEFS, type Role } from "./definitions.js";

/**
 * Bring up all three demo sellers (serve only — no registration). Use when the
 * sellers are already registered and you just need them live for a demo run.
 */
const ROLES: Role[] = ["honest", "honest2", "liar"];
const running: RunningSeller[] = [];
// Explicit ports — see register-all.ts.
for (const role of ROLES) {
  running.push(await startSeller(role, SELLER_DEFS[role].port));
}

console.log("Demo sellers up:");
for (const r of running) {
  console.log(
    `  ${r.role.padEnd(8)} ${r.seller.name.padEnd(16)} ${r.url}  poisoned=${r.state.poisoned}`,
  );
}
console.log("Ctrl-C to stop.");
