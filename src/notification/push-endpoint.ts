import { ValidateBy, ValidationOptions } from 'class-validator';

/**
 * Hosts of the browser push services. The server POSTs to whatever endpoint a
 * client registers, so an unrestricted URL would let any learner aim this
 * service at internal hosts (blind SSRF). Browsers only ever hand out endpoints
 * on these services.
 */
const PUSH_SERVICE_HOSTS: readonly RegExp[] = [
    /^fcm\.googleapis\.com$/, // Chrome, Edge (Chromium), Opera, Brave, Samsung
    /^([a-z0-9-]+\.)*push\.services\.mozilla\.com$/, // Firefox
    /^([a-z0-9-]+\.)*notify\.windows\.com$/, // legacy Edge / WNS
    /^([a-z0-9-]+\.)*push\.apple\.com$/, // Safari
];

export function isAllowedPushEndpoint(value: unknown): boolean {
    if (typeof value !== 'string' || value.length > 2048) return false;
    let url: URL;
    try {
        url = new URL(value);
    } catch {
        return false;
    }
    if (url.protocol !== 'https:' || url.port !== '' || url.username) {
        return false;
    }
    return PUSH_SERVICE_HOSTS.some((host) => host.test(url.hostname));
}

export function IsPushEndpoint(options?: ValidationOptions): PropertyDecorator {
    return ValidateBy(
        {
            name: 'isPushEndpoint',
            validator: {
                validate: (value) => isAllowedPushEndpoint(value),
                defaultMessage: () =>
                    'endpoint must be an https URL on a known browser push service',
            },
        },
        options,
    );
}
