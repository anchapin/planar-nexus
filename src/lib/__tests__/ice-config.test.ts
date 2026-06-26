/**
 * @fileOverview Tests for ICE / STUN / TURN configuration.
 *
 * Issue #983: DEFAULT_TURN_SERVERS returned an empty array when TURN env
 * vars were unset, leaving users behind symmetric NATs with no relay
 * fallback and 100% connection failure. These tests pin the fix: the
 * default TURN set is always non-empty, env overrides work, and a warning
 * is surfaced when only the public fallback is in use.
 */

import {
  DEFAULT_STUN_SERVERS,
  DEFAULT_TURN_SERVERS,
  PUBLIC_FALLBACK_TURN_SERVERS,
  ICEConfigurationManager,
  resolveTurnServers,
  warnIfNoEnvTurnConfigured,
  __resetTurnWarningGuard,
  type ICEServerConfig,
} from '../ice-config';

function isTurnScheme(url: unknown): boolean {
  if (typeof url !== 'string') return false;
  return url.startsWith('turn:') || url.startsWith('turns:');
}

describe('DEFAULT_STUN_SERVERS', () => {
  it('is non-empty', () => {
    expect(DEFAULT_STUN_SERVERS.length).toBeGreaterThan(0);
  });

  it('contains only stun: URLs', () => {
    for (const server of DEFAULT_STUN_SERVERS) {
      const url = typeof server.urls === 'string' ? server.urls : '';
      expect(url.startsWith('stun:')).toBe(true);
    }
  });
});

describe('PUBLIC_FALLBACK_TURN_SERVERS', () => {
  it('is non-empty', () => {
    expect(PUBLIC_FALLBACK_TURN_SERVERS.length).toBeGreaterThan(0);
  });

  it('every server is a turn/turns URL with password credentials', () => {
    for (const server of PUBLIC_FALLBACK_TURN_SERVERS) {
      expect(isTurnScheme(server.urls)).toBe(true);
      expect(typeof server.username).toBe('string');
      expect(server.username!.length).toBeGreaterThan(0);
      expect(typeof server.credential).toBe('string');
      expect(server.credential!.length).toBeGreaterThan(0);
      expect(server.credentialType).toBe('password');
    }
  });
});

describe('DEFAULT_TURN_SERVERS', () => {
  it('is non-empty (NAT traversal relay fallback) — regression for #983', () => {
    expect(DEFAULT_TURN_SERVERS.length).toBeGreaterThan(0);
  });

  it('contains only turn:/turns: URLs', () => {
    for (const server of DEFAULT_TURN_SERVERS) {
      const url = typeof server.urls === 'string' ? server.urls : '';
      expect(isTurnScheme(url)).toBe(true);
    }
  });

  it('every server has username + credential', () => {
    for (const server of DEFAULT_TURN_SERVERS) {
      expect(server.username).toBeTruthy();
      expect(server.credential).toBeTruthy();
      expect(server.credentialType).toBe('password');
    }
  });
});

describe('resolveTurnServers', () => {
  afterEach(() => {
    __resetTurnWarningGuard();
  });

  it('returns env-configured servers when all three env vars are set', () => {
    const result = resolveTurnServers({
      NEXT_PUBLIC_TURN_URL: 'turn:turn.example.com:3478',
      NEXT_PUBLIC_TURN_USER: 'alice',
      NEXT_PUBLIC_TURN_PASS: 's3cret',
    });

    expect(result.usedFallback).toBe(false);
    expect(result.servers).toHaveLength(1);
    expect(result.servers[0]).toEqual({
      urls: 'turn:turn.example.com:3478',
      username: 'alice',
      credential: 's3cret',
      credentialType: 'password',
    });
  });

  it('supports comma-separated TURN URLs sharing one credential set', () => {
    const result = resolveTurnServers({
      NEXT_PUBLIC_TURN_URL:
        'turn:a.example.com:3478, turns:b.example.com:5349, turn:c.example.com:3478',
      NEXT_PUBLIC_TURN_USER: 'u',
      NEXT_PUBLIC_TURN_PASS: 'p',
    });

    expect(result.usedFallback).toBe(false);
    expect(result.servers).toHaveLength(3);
    expect(result.servers.map((s) => s.urls)).toEqual([
      'turn:a.example.com:3478',
      'turns:b.example.com:5349',
      'turn:c.example.com:3478',
    ]);
    for (const server of result.servers) {
      expect(server.username).toBe('u');
      expect(server.credential).toBe('p');
      expect(server.credentialType).toBe('password');
    }
  });

  it('trims whitespace and ignores empty entries in the URL list', () => {
    const result = resolveTurnServers({
      NEXT_PUBLIC_TURN_URL: ' turn:a.example.com:3478 , , turn:b.example.com:3478 ',
      NEXT_PUBLIC_TURN_USER: 'u',
      NEXT_PUBLIC_TURN_PASS: 'p',
    });

    expect(result.servers).toHaveLength(2);
    expect(result.servers[0].urls).toBe('turn:a.example.com:3478');
    expect(result.servers[1].urls).toBe('turn:b.example.com:3478');
  });

  it('falls back to public TURN servers when env vars are absent', () => {
    const result = resolveTurnServers({});

    expect(result.usedFallback).toBe(true);
    expect(result.servers.length).toBe(PUBLIC_FALLBACK_TURN_SERVERS.length);
    for (const server of result.servers) {
      expect(isTurnScheme(server.urls)).toBe(true);
      expect(server.username).toBeTruthy();
      expect(server.credential).toBeTruthy();
    }
  });

  it('falls back when only some env vars are set (no partial credentials)', () => {
    const onlyUrl = resolveTurnServers({
      NEXT_PUBLIC_TURN_URL: 'turn:turn.example.com:3478',
    });
    expect(onlyUrl.usedFallback).toBe(true);

    const urlAndUser = resolveTurnServers({
      NEXT_PUBLIC_TURN_URL: 'turn:turn.example.com:3478',
      NEXT_PUBLIC_TURN_USER: 'u',
    });
    expect(urlAndUser.usedFallback).toBe(true);
  });

  it('falls back when NEXT_PUBLIC_TURN_URL is empty/whitespace', () => {
    const result = resolveTurnServers({
      NEXT_PUBLIC_TURN_URL: '   ',
      NEXT_PUBLIC_TURN_USER: 'u',
      NEXT_PUBLIC_TURN_PASS: 'p',
    });
    expect(result.usedFallback).toBe(true);
  });

  it('returns fresh array copies (mutating results does not affect fallbacks)', () => {
    const a = resolveTurnServers({});
    const b = resolveTurnServers({});
    expect(a.servers).not.toBe(b.servers);
    expect(a.servers[0]).not.toBe(PUBLIC_FALLBACK_TURN_SERVERS[0]);

    a.servers[0].username = 'mutated';
    expect(PUBLIC_FALLBACK_TURN_SERVERS[0].username).toBe('openrelayproject');
    expect(b.servers[0].username).toBe('openrelayproject');
  });
});

describe('warnIfNoEnvTurnConfigured', () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    __resetTurnWarningGuard();
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
    __resetTurnWarningGuard();
  });

  it('warns when the public fallback is in use', () => {
    warnIfNoEnvTurnConfigured(resolveTurnServers({}));
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const message = warnSpy.mock.calls[0][0] as string;
    expect(message).toContain('TURN');
    expect(message).toContain('NEXT_PUBLIC_TURN_URL');
  });

  it('does not warn when env-configured servers are in use', () => {
    warnIfNoEnvTurnConfigured(
      resolveTurnServers({
        NEXT_PUBLIC_TURN_URL: 'turn:turn.example.com:3478',
        NEXT_PUBLIC_TURN_USER: 'u',
        NEXT_PUBLIC_TURN_PASS: 'p',
      }),
    );
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('warns only once across calls unless forced', () => {
    warnIfNoEnvTurnConfigured(resolveTurnServers({}));
    warnIfNoEnvTurnConfigured(resolveTurnServers({}));
    expect(warnSpy).toHaveBeenCalledTimes(1);

    warnIfNoEnvTurnConfigured(resolveTurnServers({}), true);
    expect(warnSpy).toHaveBeenCalledTimes(2);
  });
});

describe('ICEConfigurationManager integration with default TURN', () => {
  it('default manager has TURN servers (NAT traversal works out of the box)', () => {
    const manager = new ICEConfigurationManager();
    expect(manager.hasTurnServers()).toBe(true);
  });

  it('default RTCConfiguration includes at least one turn/turns server', () => {
    const manager = new ICEConfigurationManager();
    const config = manager.getRTCConfiguration();
    const iceServers = config.iceServers ?? [];

    expect(iceServers.length).toBeGreaterThan(0);

    const hasTurn = iceServers.some((server) => {
      const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
      return urls.some((url) => isTurnScheme(url));
    });
    expect(hasTurn).toBe(true);
  });

  it('still allows callers to override with their own TURN servers', () => {
    const custom: ICEServerConfig[] = [
      {
        urls: 'turn:custom.example.com:3478',
        username: 'me',
        credential: 'pw',
        credentialType: 'password',
      },
    ];
    const manager = new ICEConfigurationManager({ customTurnServers: custom });
    expect(manager.getTurnServers()).toEqual(custom);
  });

  it('turn-relay mode surfaces TURN servers for forced relay', () => {
    const manager = new ICEConfigurationManager({ mode: 'turn-relay' });
    const config = manager.getRTCConfiguration();
    expect(config.iceTransportPolicy).toBe('relay');
    const iceServers = config.iceServers ?? [];
    expect(iceServers.length).toBeGreaterThan(0);
    const allTurn = iceServers.every((server) => {
      const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
      return urls.every((url) => isTurnScheme(url));
    });
    expect(allTurn).toBe(true);
  });
});
