import { describe, expect, it } from 'vitest';

import { createDevicesDb } from './testing/devicesDb.js';
import { createTrustedDevicesRepo } from './trustedDevices.js';

function setup() {
  const repo = createTrustedDevicesRepo(createDevicesDb());
  repo.insert(1, 'h-old', 'Firefox · Linux', 100, 1_000);
  repo.insert(1, 'h-new', 'Chrome · Android', 200, 1_000);
  repo.insert(1, 'h-expired', 'Safari · iOS', 300, 150);
  repo.insert(2, 'h-other', 'Edge · Windows', 100, 1_000);
  return repo;
}

describe('createTrustedDevicesRepo', () => {
  it("liste les appareils non expirés du compte, le dernier utilisé d'abord", () => {
    const repo = setup();
    expect(repo.list(1, 160).map((d) => d.token_hash)).toEqual(['h-new', 'h-old']);
  });

  it('retrouve un appareil par empreinte et met à jour sa dernière utilisation', () => {
    const repo = setup();
    const device = repo.getByHash('h-old');
    expect(device).toMatchObject({ user_id: 1, label: 'Firefox · Linux', last_used_at: 100 });
    repo.touch(device!.id, 500);
    expect(repo.list(1, 160).map((d) => d.token_hash)).toEqual(['h-old', 'h-new']);
  });

  it('purge les appareils expirés', () => {
    const repo = setup();
    repo.purgeExpired(150);
    expect(repo.getByHash('h-expired')).toBeUndefined();
    expect(repo.getByHash('h-old')).toBeDefined();
  });

  it("ne lit ni ne supprime l'appareil d'un autre compte", () => {
    const repo = setup();
    const other = repo.getByHash('h-other')!;
    expect(repo.get(other.id, 1)).toBeUndefined();
    expect(repo.remove(other.id, 1).changes).toBe(0);
    expect(repo.get(other.id, 2)).toBeDefined();
    expect(repo.remove(other.id, 2).changes).toBe(1);
  });

  it("supprime par empreinte, ou tous les appareils d'un compte", () => {
    const repo = setup();
    repo.deleteByHash('h-old');
    expect(repo.getByHash('h-old')).toBeUndefined();
    repo.revokeAll(1);
    expect(repo.list(1, 0)).toEqual([]);
    expect(repo.list(2, 0)).toHaveLength(1);
  });
});
