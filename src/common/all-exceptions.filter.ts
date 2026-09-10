import {
    ArgumentsHost,
    Catch,
    ExceptionFilter,
    HttpException,
    HttpStatus,
    Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';
import { getRequestId } from './request-context';

/**
 * The one place an unhandled error becomes a response.
 *
 * Without it, a Prisma error surfaced as a bare 500 with the query in the body:
 * a duplicate row read as a server fault rather than a conflict, and callers
 * could not tell a retryable failure from a permanent one. Every response
 * carries the request id so a user-visible error can be found in the logs.
 *
 * Only the status and a safe message cross the boundary. The detail is logged.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
    private readonly logger = new Logger('Exception');

    catch(exception: unknown, host: ArgumentsHost): void {
        // Kafka consumers and other non-HTTP contexts have no response to write;
        // rethrowing lets the consumer's own error handling deal with it.
        if (host.getType() !== 'http') throw exception;

        const context = host.switchToHttp();
        const response = context.getResponse<Response>();
        const request = context.getRequest<Request>();
        const requestId = getRequestId();

        const { status, message } = this.resolve(exception);

        const detail =
            exception instanceof Error ? exception.stack : String(exception);
        const line = `${request.method} ${request.url} -> ${status}`;

        if (status >= 500) {
            this.logger.error(`${line}: ${detail}`);
        } else {
            this.logger.warn(`${line}: ${JSON.stringify(message)}`);
        }

        if (response.headersSent) return;

        response.status(status).json({
            statusCode: status,
            message,
            requestId,
        });
    }

    private resolve(exception: unknown): { status: number; message: unknown } {
        if (exception instanceof HttpException) {
            const body = exception.getResponse();
            return {
                status: exception.getStatus(),
                message:
                    typeof body === 'object' &&
                    body !== null &&
                    'message' in body
                        ? (body as { message: unknown }).message
                        : body,
            };
        }

        if (exception instanceof Prisma.PrismaClientKnownRequestError) {
            switch (exception.code) {
                case 'P2002':
                    return {
                        status: HttpStatus.CONFLICT,
                        message: 'That record already exists.',
                    };
                case 'P2025':
                    return {
                        status: HttpStatus.NOT_FOUND,
                        message: 'Not found.',
                    };
                case 'P2003':
                    return {
                        status: HttpStatus.BAD_REQUEST,
                        message: 'That reference is not valid.',
                    };
            }
        }

        // Anything unrecognised is a bug here, not the caller's fault, and its
        // detail stays in the log.
        return {
            status: HttpStatus.INTERNAL_SERVER_ERROR,
            message: 'Something went wrong on our side.',
        };
    }
}
