import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createDatabase, type TicDatabase } from './db.js';
import { Storage } from './index.js';

describe('Color Mappings', () => {
  let db: TicDatabase;
  let storage: Storage;

  beforeEach(() => {
    db = createDatabase(':memory:');
    storage = Storage.createFromDb(db);
  });

  afterEach(() => {
    db.close();
  });

  it('returns empty array when no mappings exist', async () => {
    const mappings = await storage.getColorMappings();
    expect(mappings).toEqual([]);
  });

  it('sets and retrieves a color mapping', async () => {
    await storage.setColorMapping('status', 'todo', '#ffffff', '#000000');
    const mappings = await storage.getColorMappings();
    expect(mappings).toEqual([
      { fieldType: 'status', value: 'todo', bg: '#ffffff', fg: '#000000' },
    ]);
  });

  it('upserts existing mapping', async () => {
    await storage.setColorMapping('status', 'todo', '#ffffff', '#000000');
    await storage.setColorMapping('status', 'todo', '#ff0000', '#00ff00');
    const mappings = await storage.getColorMappings();
    expect(mappings).toHaveLength(1);
    expect(mappings[0]).toEqual({
      fieldType: 'status',
      value: 'todo',
      bg: '#ff0000',
      fg: '#00ff00',
    });
  });

  it('deletes a single mapping', async () => {
    await storage.setColorMapping('status', 'todo', '#ffffff', '#000000');
    await storage.setColorMapping('status', 'done', '#00ff00', '#000000');
    await storage.deleteColorMapping('status', 'todo');
    const mappings = await storage.getColorMappings();
    expect(mappings).toEqual([
      { fieldType: 'status', value: 'done', bg: '#00ff00', fg: '#000000' },
    ]);
  });

  it('deletes all mappings for a field type', async () => {
    await storage.setColorMapping('status', 'todo', '#ffffff', '#000000');
    await storage.setColorMapping('status', 'done', '#00ff00', '#000000');
    await storage.setColorMapping('priority', 'high', '#ff0000', '#ffffff');
    await storage.deleteColorMappingsByField('status');
    const mappings = await storage.getColorMappings();
    expect(mappings).toEqual([
      { fieldType: 'priority', value: 'high', bg: '#ff0000', fg: '#ffffff' },
    ]);
  });
});
