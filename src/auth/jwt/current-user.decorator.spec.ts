import { UnauthorizedException } from '@nestjs/common';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { CurrentUser } from './current-user.decorator';

/**
 * `createParamDecorator` hides the factory behind route metadata, so the only
 * way to exercise it is to apply the decorator and dig the factory back out.
 */
function factoryOf(decorator: ParameterDecorator) {
    class Probe {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        handler(_value: string) {}
    }
    decorator(Probe.prototype, 'handler', 0);
    const metadata = Reflect.getMetadata(
        ROUTE_ARGS_METADATA,
        Probe,
        'handler',
    ) as Record<string, { factory: (data: unknown, ctx: unknown) => string }>;
    return Object.values(metadata)[0].factory;
}

describe('@CurrentUser()', () => {
    const factory = factoryOf(CurrentUser());

    const contextFor = (request: unknown) =>
        ({ switchToHttp: () => ({ getRequest: () => request }) }) as never;

    it('returns the subject of the verified token', () => {
        expect(
            factory(undefined, contextFor({ user: { sub: 'user-1' } })),
        ).toBe('user-1');
    });

    it('refuses to invent an identity when none was established', () => {
        // AccessGuard is deny-by-default, so this only happens if a @Public()
        // route asks who the caller is. Returning undefined would let the
        // handler query by `undefined` and quietly match nothing — or worse.
        expect(() => factory(undefined, contextFor({}))).toThrow(
            UnauthorizedException,
        );
    });
});
