import { registerRunningSeller, startSeller } from "./run-seller.js";

const running = await startSeller("honest2");
console.log(
  `[honest2] ${running.seller.name} serving at ${running.url}  (pubkey ${running.seller.solanaPubkey})`,
);
if (process.env.SELF_REGISTER === "1") {
  await registerRunningSeller(running);
  console.log(`[honest2] registered id=${running.seller.id}`);
}
