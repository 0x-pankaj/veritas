import type { FastifyInstance, FastifyPluginOptions } from "fastify";
import {
  SERVE_PATH,
  build402,
  handleServe,
  type SellerMiddlewareOpts,
} from "./core.js";

/**
 * Fastify adapter (PRODUCT §3.2). Register with
 * `app.register(veritasSellerPlugin, { veritas: opts })`. Registers the same
 * two routes as the Express adapter.
 */
export function veritasSellerPlugin(
  app: FastifyInstance,
  pluginOpts: FastifyPluginOptions & { veritas: SellerMiddlewareOpts },
  done: (err?: Error) => void,
): void {
  const opts = pluginOpts.veritas;
  app.post(SERVE_PATH, async (req, reply) => {
    const credential = req.headers["x-veritas-coordinator"];
    const outcome = await handleServe(
      opts,
      Array.isArray(credential) ? credential[0] : credential,
      req.body,
    );
    return reply.code(outcome.status).send(outcome.body);
  });
  app.get("/veritas/402", async (_req, reply) => {
    const outcome = build402(opts);
    return reply.code(outcome.status).send(outcome.body);
  });
  done();
}
