import { ConsoleLogger, Injectable, Scope } from '@nestjs/common';
import { getRequestId } from './request-context';

/**
 * Nest's console logger, with the current request id on every line.
 *
 * Correlation is the thing that was missing: a failure the learner saw and the
 * stack trace that caused it were two unrelated lines in two containers, with
 * nothing to join them. The id comes from AsyncLocalStorage rather than being
 * threaded through call sites, so code that logs needs no knowledge of it —
 * including code that runs outside a request, where it is simply absent.
 *
 * Not JSON: nothing aggregates these logs yet. When something does, this is the
 * single place that has to change.
 */
@Injectable({ scope: Scope.DEFAULT })
export class RequestContextLogger extends ConsoleLogger {
    protected formatMessage(
        logLevel: Parameters<ConsoleLogger['formatMessage']>[0],
        message: unknown,
        pidMessage: string,
        formattedLogLevel: string,
        contextMessage: string,
        timestampDiff: string,
    ): string {
        const requestId = getRequestId();
        const withId = requestId
            ? `${contextMessage}[${requestId}] `
            : contextMessage;

        return super.formatMessage(
            logLevel,
            message,
            pidMessage,
            formattedLogLevel,
            withId,
            timestampDiff,
        );
    }
}
