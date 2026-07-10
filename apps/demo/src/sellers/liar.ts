import { registerRunningSeller, startSeller } from "./run-seller.js";

const running = await startSeller("liar");
console.log(
  `[liar] ${running.seller.name} serving at ${running.url}  (pubkey ${running.seller.solanaPubkey})`,
);
console.log(
  `[liar] poisoned=${running.state.poisoned}. Toggle: POST ${running.url}/control/poison { "on": false }`,
);
if (process.env.SELF_REGISTER === "1") {
  await registerRunningSeller(running);
  console.log(`[liar] registered id=${running.seller.id}`);
}
