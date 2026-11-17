import type { FastifyInstance } from 'fastify';
import { endAllActiveHolds } from './operate-policy.js';

/**
 * Error handling + request tracing.
 *
 * - 5xx responses never echo internal error messages (DB / library text) to clients;
 *   they get a generic message plus the request id so a report can be matched to logs.
 * - 4xx errors (validation, rate limit, …) keep their message.
 * - Every response carries `X-Request-Id`.
 */
export function registerObservability(app: FastifyInstance) {
  app.addHook('onSend', async (req, reply, payload) => {
    reply.header('X-Request-Id', req.id);
    return payload;
  });

  app.setErrorHandler((err: Error & { statusCode?: number; code?: string }, req, reply) => {
    const status = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500;
    if (status >= 500) {
      req.log.error({ err, requestId: req.id }, 'Unhandled request error');
      return reply.code(status).send({ error: 'Internal server error', requestId: req.id });
    }
    return reply.code(status).send({ error: err.message, code: err.code });
  });
}

/**
 * Last line of defence for programmer errors that escape every handler.
 * Node's default is to crash on these; we keep that (state is unknown) but first end any
 * running holds, because their in-memory auto-end timers are about to be lost with us.
 */
export function installProcessErrorHandlers(
  log: { fatal: (obj: unknown, msg: string) => void },
  exit: (code: number) => void = (code) => process.exit(code),
) {
  let crashing = false;
  const crash = (kind: string) => (err: unknown) => {
    if (crashing) return;
    crashing = true;
    log.fatal({ err }, `${kind} — ending active holds and exiting`);
    // Shares the shutdown drain if one is already running; bounded so a dead broker
    // cannot keep a crashed process alive.
    void endAllActiveHolds(2_000)
      .then(
        (acknowledged) => log.fatal({ acknowledgedHoldEnds: acknowledged }, 'Hold drain finished'),
        () => undefined,
      )
      .finally(() => exit(1));
  };
  process.on('uncaughtException', crash('uncaughtException'));
  process.on('unhandledRejection', crash('unhandledRejection'));
}
