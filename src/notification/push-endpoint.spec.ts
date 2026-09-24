import { isAllowedPushEndpoint } from './push-endpoint';

describe('isAllowedPushEndpoint', () => {
    it.each([
        'https://fcm.googleapis.com/fcm/send/abc:APA91b',
        'https://updates.push.services.mozilla.com/wpush/v2/gAAAA',
        'https://wns2-par02p.notify.windows.com/w/?token=BQYAAA',
        'https://web.push.apple.com/QGuQyavXutnMH',
    ])('accepts %s', (endpoint) => {
        expect(isAllowedPushEndpoint(endpoint)).toBe(true);
    });

    it.each([
        'http://fcm.googleapis.com/fcm/send/abc',
        'https://fcm.googleapis.com:8443/fcm/send/abc',
        'https://user@fcm.googleapis.com/fcm/send/abc',
        'https://fcm.googleapis.com.evil.com/x',
        'https://evilpush.apple.com.attacker.net/x',
        'https://169.254.169.254/latest/meta-data',
        'http://localhost:3002/words',
        'https://vocabulary-service/words',
        'not a url',
        42,
    ])('rejects %s', (endpoint) => {
        expect(isAllowedPushEndpoint(endpoint)).toBe(false);
    });
});
