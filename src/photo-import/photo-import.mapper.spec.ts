import { toDrafts } from './photo-import.mapper';

const areas = [{ id: 'a1', name: 'Errands' }];

describe('toDrafts', () => {
  it('builds a checklist description and snaps effort and area', () => {
    const [d] = toDrafts(
      { tasks: [{ title: 'Groceries', checklist: ['Milk <2>', ' ', 'Eggs'], effortMinutes: 50, area: 'errands' }] },
      areas
    );
    expect(d.description).toBe('<ul data-checklist><li>Milk &lt;2&gt;</li><li>Eggs</li></ul>');
    expect(d.estimatedMinutes).toBe(60);
    expect(d.areaId).toBe('a1');
  });

  it('turns a bad enum or date into null instead of failing the task', () => {
    const [d] = toDrafts(
      { tasks: [{ title: 'Renew permit', priority: 'urgent', dueDate: 'soon', recurrence: 'custom' }] },
      areas
    );
    expect(d).toMatchObject({ title: 'Renew permit', priority: null, dueDate: null, recurrence: null });
  });

  it('returns nothing for malformed output', () => {
    expect(toDrafts({ nope: 1 }, areas)).toEqual([]);
    expect(toDrafts({ tasks: [{ title: '  ' }] }, areas)).toEqual([]);
  });
});
