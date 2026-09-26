import { parsePathProgressPayload } from './path-progress.logic';

describe('parsePathProgressPayload', () => {
    const valid = {
        userLoginId: '0190a000-0000-7000-8000-000000000001',
        lessonsCompleted: 4,
        unitsCompleted: 1,
        stagesCompleted: 0,
        occurredAt: '2026-09-26T10:00:00.000Z',
    };

    it('accepts a well-formed event', () => {
        expect(parsePathProgressPayload(valid)).toEqual({
            ...valid,
            occurredAt: new Date(valid.occurredAt),
        });
    });

    it.each([
        ['null', null],
        ['an unparsed string', JSON.stringify(valid)],
        ['a non-uuid user', { ...valid, userLoginId: 'nope' }],
        ['a missing total', { ...valid, unitsCompleted: undefined }],
        ['a negative total', { ...valid, lessonsCompleted: -1 }],
        ['a fractional total', { ...valid, lessonsCompleted: 1.5 }],
        ['an absurd total', { ...valid, lessonsCompleted: 1e9 }],
        ['a total as a string', { ...valid, stagesCompleted: '1' }],
        ['a missing time', { ...valid, occurredAt: undefined }],
        ['a bad time', { ...valid, occurredAt: 'yesterday' }],
    ])('rejects %s', (_label, payload) => {
        expect(parsePathProgressPayload(payload)).toBeNull();
    });
});
