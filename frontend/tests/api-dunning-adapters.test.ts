import { describe, expect, it } from 'vitest';
import { blankStage, describeStageDays, toDunningForm, toDunningRequest } from '../src/api/adapters/dunning';
import { blankWorkflow, toWorkflowRequest } from '../src/api/adapters/admin';

const allowed = ['document_number', 'contact_name', 'days_overdue', 'amount_due', 'total', 'due_date', 'payment_instructions', 'sender_name', 'company_name'];
const settings = {
  enabled: true,
  stages: [{ id: 's1', days_after_due: 7, subject: 'S', body: 'B', sent_count: 2 }],
  placeholders: {},
  version: 3,
  can: { update: true },
};

describe('dunning form', () => {
  it('round-trips the saved settings, keeping the stage id and the version', () => {
    const form = toDunningForm(settings);
    expect(form.stages[0]).toMatchObject({ id: 's1', days: '7', sentCount: 2 });
    const built = toDunningRequest(form, 3, allowed);
    expect(built).toEqual({ ok: true, body: { enabled: true, stages: [{ id: 's1', days_after_due: 7, subject: 'S', body: 'B' }], version: 3 } });
  });

  it('refuses duplicate days, days out of range, unknown placeholders and an empty on-switch', () => {
    const form = toDunningForm(settings);
    const dup = { ...form, stages: [form.stages[0]!, { ...blankStage(7) }] };
    const r1 = toDunningRequest(dup, 3, allowed);
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.errors.days1).toMatch(/already uses/);
    const r2 = toDunningRequest({ ...form, stages: [{ ...form.stages[0]!, days: '0' }] }, 3, allowed);
    expect(r2.ok === false && r2.errors.days0).toBeTruthy();
    const r3 = toDunningRequest({ ...form, stages: [{ ...form.stages[0]!, body: 'Pay {{ secret }}' }] }, 3, allowed);
    expect(r3.ok === false && r3.errors.text0).toMatch(/secret/);
    const r4 = toDunningRequest({ enabled: true, stages: [] }, 3, allowed);
    expect(r4.ok === false && r4.errors.stages).toBeTruthy();
  });

  it('the default stage wording uses only allowed placeholders', () => {
    const stage = blankStage(7);
    const r = toDunningRequest({ enabled: true, stages: [stage] }, 0, allowed);
    expect(r.ok).toBe(true);
    expect(describeStageDays(1)).toBe('1 day after the due date');
    expect(describeStageDays(14)).toBe('14 days after the due date');
  });
});

describe('workflow reminder time', () => {
  const base = { ...blankWorkflow(), name: 'W', steps: [{ role: 'Approver', count: '1' }] };

  it('sends null when empty and the number of hours otherwise', () => {
    const none = toWorkflowRequest(base, 2);
    expect(none.ok && none.body.remind_after_hours).toBeNull();
    const some = toWorkflowRequest({ ...base, remind: '24' }, 2);
    expect(some.ok && some.body.remind_after_hours).toBe(24);
  });

  it('refuses hours out of range', () => {
    for (const bad of ['0', '721', 'x', '1.5']) {
      const r = toWorkflowRequest({ ...base, remind: bad }, 2);
      expect(r.ok === false && r.errors.remind).toBeTruthy();
    }
  });
});
