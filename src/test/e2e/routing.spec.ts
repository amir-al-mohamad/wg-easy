import type { Page } from '@playwright/test';

import { expect, test } from './fixtures';
import { createClient, downloadConfiguration, goto, login } from './helpers';

async function addRule(
  page: Page,
  rule: { name: string; action: 'Direct' | 'Block'; address: string }
) {
  await page.getByRole('button', { name: 'Add rule', exact: true }).click();
  const form = page.locator('form', {
    has: page.getByRole('heading', { name: 'New rule', exact: true }),
  });
  await form.getByLabel('Name', { exact: true }).fill(rule.name);
  await form.getByRole('combobox', { name: 'Send through' }).click();
  await page.getByRole('option', { name: rule.action, exact: true }).click();
  await form
    .getByLabel('Addresses and subnets, one per line')
    .fill(rule.address);
  await form.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(form).toBeHidden();
  return page.getByRole('listitem').filter({ hasText: rule.name });
}

test('a rule applies to new connections, and open ones keep their route', async ({
  page,
  app,
}) => {
  await login(page);
  const card = await createClient(page, 'Routed client');
  const { contents } = await downloadConfiguration(page, card);
  await app.connectClient(contents);
  await expect.poll(() => app.pingFromClient('10.8.0.1')).toBe(true);

  const uplink = await app.uplinkGateway();
  const canReachUplink = () => app.pingFromClient(uplink);
  await expect.poll(canReachUplink).toBe(true);

  await goto(page, '/admin/routing');
  // Any rule puts the router in place; from then on every connection's route
  // is decided on its first packet and remembered.
  await addRule(page, {
    name: 'Documentation range',
    action: 'Direct',
    address: '192.0.2.0/24',
  });
  await expect.poll(canReachUplink).toBe(true);

  await app.startPingFromClient(uplink);
  await expect.poll(() => app.pingReplies()).toBeGreaterThan(2);

  const block = await addRule(page, {
    name: 'Block uplink',
    action: 'Block',
    address: uplink,
  });

  // A new connection follows the rule...
  await expect.poll(canReachUplink).toBe(false);
  // ...while the one already open keeps the route it started with.
  const before = await app.pingReplies();
  await expect.poll(() => app.pingReplies()).toBeGreaterThan(before + 3);

  await block.getByRole('button', { name: 'Remove' }).first().click();
  await page.getByRole('button', { name: 'Delete rule', exact: true }).click();
  await expect(block).toBeHidden();
  await expect.poll(canReachUplink).toBe(true);
});
