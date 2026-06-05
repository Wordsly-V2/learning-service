import {
    CanActivate,
    ExecutionContext,
    Injectable,
    UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';

@Injectable()
export class InternalServiceGuard implements CanActivate {
    constructor(private readonly configService: ConfigService) {}

    canActivate(context: ExecutionContext): boolean | Promise<boolean> {
        if (context.getType() !== 'http') {
            return true;
        }

        const request = context
            .switchToHttp()
            .getRequest<
                Request & { headers: { 'x-service-token': string | undefined } }
            >();

        const serviceToServiceToken = request.headers['x-service-token'];
        if (!serviceToServiceToken) {
            throw new UnauthorizedException();
        }

        const internalToken = this.configService.get<string>(
            'internalServiceToServiceToken',
        );

        if (serviceToServiceToken !== internalToken) {
            throw new UnauthorizedException();
        }

        return true;
    }
}
