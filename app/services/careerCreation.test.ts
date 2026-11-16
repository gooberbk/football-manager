import type { CareerState } from '../db/careerPersistence';

// Mock the database layer so career creation can be tested without
// expo-sqlite. The engine and Zustand store stay real.
jest.mock('../db', () => ({
  initializeDatabase: jest.fn().mockResolvedValue(undefined),
  saveCareer: jest.fn().mockResolvedValue(undefined),
}));

// careerCreation publishes through the shared Zustand store and the db
// module is mocked above, so a fresh module registry per test gives a
// clean store and clean mocks.
async function freshCreation() {
  jest.resetModules();
  const db = await import('../db');
  const { createCareer } = await import('./careerCreation');
  const { useGameState } = await import('../store/useGameState');
  return {
    createCareer,
    getStore: () => useGameState.getState(),
    mockSaveCareer: db.saveCareer as jest.Mock,
    mockInitDatabase: db.initializeDatabase as jest.Mock,
  };
}

describe('createCareer', () => {
  it('marks bootStatus as loaded and populates the store after a successful save', async () => {
    const { createCareer, getStore } = await freshCreation();
    // Simulate the normal entry path: boot found no career.
    getStore().setBootStatus('empty');

    await createCareer(0);
    const store = getStore();

    expect(store.bootStatus).toBe('loaded');
    expect(store.isLoading).toBe(false);
    expect(store.managedClubId).not.toBeNull();
    expect(store.clubs.length).toBeGreaterThan(0);
    expect(store.players.length).toBeGreaterThan(0);
    expect(store.league).not.toBeNull();
    expect(store.season).not.toBeNull();
    expect(store.transferOffers).toEqual([]);
    expect(store.transferHistory).toEqual([]);
  });

  it('passes a complete CareerState including transferOffers to saveCareer', async () => {
    const { createCareer, mockSaveCareer, getStore } = await freshCreation();
    getStore().setBootStatus('empty');

    await createCareer(0);

    expect(mockSaveCareer).toHaveBeenCalledTimes(1);
    const saved = mockSaveCareer.mock.calls[0][0] as CareerState;
    expect(saved.career.id).toBe('active');
    expect(saved.career.managedClubId).toBe(getStore().managedClubId);
    expect(saved.transferOffers).toEqual([]);
    expect(saved.transferHistory).toEqual([]);
    expect(saved.league.fixtures.length).toBeGreaterThan(0);
    // Season objectives are generated at creation: one per club, all
    // belonging to the initial season, all unsettled.
    expect(saved.seasonObjectives).toHaveLength(16);
    expect(
      saved.seasonObjectives.every(
        (o) =>
          o.seasonId === saved.season.id &&
          o.objectiveMet === null &&
          o.settledAt === null,
      ),
    ).toBe(true);
    expect(new Set(saved.seasonObjectives.map((o) => o.clubId)).size).toBe(16);
    expect(getStore().seasonObjectives).toHaveLength(16);
  });

  it('does not publish to the store before saveCareer resolves', async () => {
    const { createCareer, getStore, mockSaveCareer } = await freshCreation();
    getStore().setBootStatus('empty');
    // Snapshot the store at the moment saveCareer is invoked: the career
    // must not be visible in the store yet.
    let publishedAtSaveTime = true;
    mockSaveCareer.mockImplementation(() => {
      const s = getStore();
      publishedAtSaveTime =
        s.league !== null ||
        s.seasonObjectives.length > 0 ||
        s.bootStatus === 'loaded';
      return Promise.resolve();
    });

    await createCareer(0);

    expect(publishedAtSaveTime).toBe(false);
    // Publication still happens after the save resolves.
    expect(getStore().seasonObjectives).toHaveLength(16);
    expect(getStore().bootStatus).toBe('loaded');
  });

  it('does not mark bootStatus as loaded when saveCareer fails', async () => {
    const { createCareer, getStore, mockSaveCareer } = await freshCreation();
    getStore().setBootStatus('empty');
    mockSaveCareer.mockRejectedValue(new Error('disk full'));

    await expect(createCareer(0)).rejects.toThrow('disk full');

    const store = getStore();
    // The store must not claim a career exists, and no career data may be
    // published — the previous 'empty' status is preserved so the index
    // gate can still route to the new-career flow.
    expect(store.bootStatus).toBe('empty');
    expect(store.managedClubId).toBeNull();
    expect(store.league).toBeNull();
    expect(store.players).toEqual([]);
  });

  it('does not mark bootStatus as loaded when initialization fails', async () => {
    const { createCareer, getStore, mockInitDatabase } = await freshCreation();
    getStore().setBootStatus('empty');
    mockInitDatabase.mockRejectedValue(new Error('migration failed'));

    await expect(createCareer(0)).rejects.toThrow('migration failed');

    const store = getStore();
    expect(store.bootStatus).toBe('empty');
    expect(store.managedClubId).toBeNull();
  });
});
