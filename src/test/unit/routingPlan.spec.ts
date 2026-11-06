import { describe, expect, test } from 'vitest';

import {
  buildPlan as buildSteps,
  CHAIN_FORWARD,
  CHAIN_MANGLE,
  CHAIN_MSS,
  CHAIN_NAT,
  isEmpty,
  isTeardown,
  renderRestore,
  staleForwards,
} from '#server/utils/routing/plan';
import type {
  InstalledRule,
  Plan,
  PlanGateway,
  PlanRule,
  Step,
} from '#server/utils/routing/plan';
import {
  BLOCK_TABLE,
  FORWARD_CONNMARK,
  MARK_BLOCK,
  MARK_DIRECT,
  RULE_PRIORITY_BLOCK,
  RULE_PRIORITY_DIRECT,
} from '#server/utils/routing/marks';

/**
 * The steps as the commands they amount to: a restore reads as the rules it
 * appends, so assertions about chain contents need not care how they land.
 */
function flatten(steps: Step[]) {
  return steps.flatMap((step) =>
    'command' in step
      ? [step.command]
      : step.restore.chains.flatMap((chain) =>
          chain.rules.map(
            (rule) =>
              `${step.restore.iptables} -t ${step.restore.table} -A ${chain.name} ${rule}`
          )
        )
  );
}

const buildPlan = (input: Plan) => flatten(buildSteps(input));

function plan(overrides: Partial<Plan> = {}): Plan {
  return {
    wgInterface: 'wg0',
    enableIpv6: true,
    localSubnets: { v4: ['10.8.0.0/24'], v6: ['fdcc:ad94::/64'] },
    gateways: [],
    rules: [],
    forwards: [],
    staleForwards: [],
    defaultFwmark: null,
    installedRules: { v4: [], v6: [] },
    ...overrides,
  };
}

function gateway(overrides: Partial<PlanGateway> = {}): PlanGateway {
  return {
    interfaceName: 'tun0',
    fwmark: '0x100',
    routeTable: 100,
    present: true,
    hasIpv6: true,
    failClosed: true,
    fallbacks: [],
    installedMetrics: { v4: [], v6: [] },
    ...overrides,
  };
}

function rule(overrides: Partial<PlanRule> = {}): PlanRule {
  return {
    id: 1,
    fwmark: '0x100',
    clients: [],
    matchAllV4: false,
    matchAllV6: false,
    ...overrides,
  };
}

/** Lines that actually classify traffic, in the order the kernel sees them. */
function mangleChain(commands: string[], table = 'iptables') {
  return commands.filter(
    (command) =>
      command.startsWith(`${table} -t mangle -A ${CHAIN_MANGLE} `) &&
      !isTeardown(command)
  );
}

/** The lines that mark traffic matched by a rule, as opposed to housekeeping. */
function ruleMarks(commands: string[], table = 'iptables') {
  return mangleChain(commands, table).filter(
    (c) => c.includes('-j MARK') && c.includes('-m mark --mark 0x0/0xffff ')
  );
}

/** A plan with something in it, so the build path runs rather than teardown. */
const populated = () => plan({ gateways: [gateway()] });

describe('buildPlan: match order', () => {
  test('guards every rule so the first match wins', () => {
    const commands = buildPlan(
      plan({
        rules: [
          rule({ id: 1, fwmark: '0x100' }),
          rule({ id: 2, fwmark: '0x101' }),
        ],
      })
    );

    const marks = ruleMarks(commands).filter((c) => c.includes('--match-set'));
    expect(marks).toHaveLength(2);

    // Without the 0x0 guard, `-j MARK` falls through and rule 2 would overwrite
    // rule 1's decision, turning "first match wins" into "last match wins".
    for (const command of marks) {
      expect(command).toContain('-m mark --mark 0x0/0xffff');
    }
  });

  test('emits rules in the order they were given', () => {
    const commands = mangleChain(
      buildPlan(
        plan({
          rules: [
            rule({ id: 7, fwmark: '0x100' }),
            rule({ id: 3, fwmark: '0x101' }),
          ],
        })
      )
    );

    const first = commands.findIndex((c) => c.includes('wgr4_7'));
    const second = commands.findIndex((c) => c.includes('wgr4_3'));
    expect(first).toBeLessThan(second);
  });

  test('returns forwarded replies and local traffic before any rule', () => {
    const commands = mangleChain(buildPlan(plan({ rules: [rule({ id: 1 })] })));

    const connmark = commands.findIndex((c) =>
      c.includes(`--mark ${FORWARD_CONNMARK}/${FORWARD_CONNMARK}`)
    );
    const local = commands.findIndex((c) => c.includes('-d 10.8.0.0/24'));
    const ruleLine = commands.findIndex((c) => c.includes('wgr4_1'));

    expect(connmark).toBeGreaterThanOrEqual(0);
    expect(connmark).toBeLessThan(local);
    expect(local).toBeLessThan(ruleLine);
    expect(commands[connmark]).toContain('-j RETURN');
    expect(commands[local]).toContain('-j RETURN');
  });

  test('appends the default action after every rule, guarded the same way', () => {
    const commands = mangleChain(
      buildPlan(plan({ rules: [rule({ id: 1 })], defaultFwmark: MARK_BLOCK }))
    );

    const fallback = commands.at(-2)!;
    expect(fallback).toContain(`--set-xmark ${MARK_BLOCK}/0xffff`);
    expect(fallback).toContain('-m mark --mark 0x0/0xffff');
    expect(fallback).not.toContain('--match-set');
  });

  test('marks unmatched traffic direct, so that decision is remembered too', () => {
    const commands = mangleChain(buildPlan(populated()));

    // Left unmarked, a connection that started direct would be classified
    // again on every packet, and move into a rule the moment its destination
    // was learned: out of the NAT mapping it was opened through.
    expect(commands.at(-2)).toBe(
      `iptables -t mangle -A ${CHAIN_MANGLE} -m mark --mark 0x0/0xffff -j MARK --set-xmark ${MARK_DIRECT}/0xffff`
    );
  });
});

describe('buildPlan: connections keep their route', () => {
  const commands = mangleChain(
    buildPlan(
      plan({
        gateways: [gateway({ fwmark: '0x100' }), gateway({ fwmark: '0x101' })],
        rules: [rule({ id: 1, fwmark: '0x100' })],
      })
    )
  );
  const index = (needle: string) =>
    commands.findIndex((c) => c.includes(needle));

  test('restores the remembered route before any rule is consulted', () => {
    const restore = index('--restore-mark --nfmask 0xffff --ctmask 0xffff');
    expect(restore).toBeGreaterThan(index('-d 10.8.0.0/24'));
    expect(restore).toBeLessThan(index('--match-set wgr4_1'));
  });

  test('keeps a route that still exists, and only those', () => {
    const kept = commands
      .filter((c) => c.endsWith('-j RETURN') && c.includes('-m mark --mark'))
      .map((c) => /--mark (\S+)\//.exec(c)![1]);

    expect(kept.sort()).toEqual(
      ['0x100', '0x101', MARK_BLOCK, MARK_DIRECT].sort()
    );
    expect(index('-m mark --mark 0x100/0xffff -j RETURN')).toBeGreaterThan(
      index('--restore-mark')
    );
  });

  test('forgets a route that is gone, so the connection is classified anew', () => {
    // A gateway switched off or removed takes its mark with it; a connection
    // still carrying that mark would otherwise reach no rule and go direct
    // whatever the policy now says.
    const forget = index('-j MARK --set-xmark 0x0/0xffff');
    expect(forget).toBeGreaterThan(
      index('-m mark --mark 0x101/0xffff -j RETURN')
    );
    expect(forget).toBeLessThan(index('--match-set wgr4_1'));
    expect(commands[forget]).not.toContain('-m mark');
  });

  test('saves the decision last, after the default', () => {
    expect(commands.at(-1)).toBe(
      `iptables -t mangle -A ${CHAIN_MANGLE} -j CONNMARK --save-mark --nfmask 0xffff --ctmask 0xffff`
    );
  });

  test('never pins client-to-client traffic', () => {
    expect(index('-d 10.8.0.0/24 -j RETURN')).toBeLessThan(
      index('--restore-mark')
    );
  });
});

describe('buildPlan: rule scoping', () => {
  test('matches every source when no client is named', () => {
    const mark = ruleMarks(buildPlan(plan({ rules: [rule({ id: 1 })] })))[0]!;
    expect(mark).not.toContain(' -s ');
  });

  test('emits one line per client address, per family', () => {
    const commands = buildPlan(
      plan({
        rules: [
          rule({
            id: 1,
            clients: [
              { ipv4: '10.8.0.4', ipv6: 'fdcc:ad94::4' },
              { ipv4: '10.8.0.5', ipv6: 'fdcc:ad94::5' },
            ],
          }),
        ],
      })
    );

    // Plus the default action, which matches every source.
    expect(ruleMarks(commands)).toHaveLength(3);
    expect(ruleMarks(commands, 'ip6tables')).toHaveLength(3);
    expect(commands.some((c) => c.includes('-s 10.8.0.4'))).toBe(true);
    expect(commands.some((c) => c.includes('-s fdcc:ad94::5'))).toBe(true);
  });

  test('skips the set lookup for a catch-all destination', () => {
    const commands = buildPlan(
      plan({ rules: [rule({ id: 1, matchAllV4: true })] })
    );

    const v4 = ruleMarks(commands)[0]!;
    expect(v4).toContain('--set-xmark 0x100/0xffff');
    expect(v4).not.toContain('--match-set');

    // `::/0` was not given, so IPv6 still goes through its set.
    const v6 = ruleMarks(commands, 'ip6tables')[0]!;
    expect(v6).toContain('--match-set wgr6_1 dst');
  });
});

describe('buildPlan: gateways', () => {
  test('routes, masquerades and clamps a live gateway', () => {
    const commands = buildPlan(plan({ gateways: [gateway()] }));

    expect(commands).toContain(
      'ip -4 rule add fwmark 0x100/0xffff priority 100 table 100'
    );
    expect(commands).toContain(
      'ip -4 route replace default dev tun0 table 100 metric 100'
    );
    expect(commands).toContain(
      `iptables -t nat -A ${CHAIN_NAT} -o tun0 -j MASQUERADE`
    );
    expect(
      commands.some(
        (c) => c.includes(CHAIN_MSS) && c.includes('--clamp-mss-to-pmtu')
      )
    ).toBe(true);
  });

  test('blackholes a gateway whose interface is gone, rather than leaking', () => {
    const commands = buildPlan(
      plan({ gateways: [gateway({ present: false })] })
    );

    // The mark and rule stay, so traffic is still steered here...
    expect(commands).toContain(
      'ip -4 rule add fwmark 0x100/0xffff priority 100 table 100'
    );
    // ...and then discarded, instead of falling back to the host uplink.
    expect(commands).toContain(
      'ip -4 route replace blackhole default table 100 metric 200'
    );
    expect(
      commands.some((c) => c.includes('route replace default dev tun0'))
    ).toBe(false);
    // A route through it left by an earlier apply is removed, tolerating that
    // the kernel usually already did so along with the interface.
    expect(commands).toContain(
      'ip -4 route del default table 100 metric 100 2>/dev/null || true'
    );
    expect(commands.some((c) => c.includes('MASQUERADE'))).toBe(false);
    expect(commands.some((c) => c.includes('--clamp-mss-to-pmtu'))).toBe(false);
  });

  test('keeps a blackhole behind the route of a live gateway', () => {
    const commands = buildPlan(plan({ gateways: [gateway()] }));

    // The kernel drops an interface's routes the moment the interface goes,
    // and an empty table falls through to main. The blackhole at the worse
    // metric is never consulted while the interface is up, and is all that
    // remains once it is gone, so the gateway fails closed between applies,
    // not only at apply time.
    for (const ip of ['ip -4', 'ip -6']) {
      expect(commands).toContain(
        `${ip} route replace blackhole default table 100 metric 200`
      );
      expect(commands).toContain(
        `${ip} route replace default dev tun0 table 100 metric 100`
      );
    }
    // Replaced in place, never flushed and refilled: an emptied table falls
    // through to main for as long as it stays empty.
    expect(commands.some((c) => c.includes('route flush table 100'))).toBe(
      false
    );
  });

  test('sends traffic direct while unavailable, when told to', () => {
    const commands = buildPlan(
      plan({ gateways: [gateway({ failClosed: false })] })
    );

    // The standing route behind the device route is a throw rather than a
    // blackhole: "not in this table, carry on", which lands in main, the same
    // outcome as no gateway at all.
    for (const ip of ['ip -4', 'ip -6']) {
      expect(commands).toContain(
        `${ip} route replace throw default table 100 metric 200`
      );
      expect(commands).toContain(
        `${ip} route replace default dev tun0 table 100 metric 100`
      );
    }
    expect(
      commands.some((c) => c.includes('blackhole default table 100'))
    ).toBe(false);
  });

  test('chains fallback gateways behind the device route, in order', () => {
    const commands = buildPlan(
      plan({
        gateways: [
          gateway({
            fallbacks: [
              { interfaceName: 'tun1', present: true, hasIpv6: true },
              { interfaceName: 'tun2', present: true, hasIpv6: false },
            ],
          }),
        ],
      })
    );

    // Own link first, then each fallback one metric further, then the end of
    // the chain: the kernel walks it by itself as links come and go.
    expect(commands).toContain(
      'ip -4 route replace default dev tun0 table 100 metric 100'
    );
    expect(commands).toContain(
      'ip -4 route replace default dev tun1 table 100 metric 101'
    );
    expect(commands).toContain(
      'ip -4 route replace default dev tun2 table 100 metric 102'
    );
    expect(commands).toContain(
      'ip -4 route replace blackhole default table 100 metric 200'
    );

    // A fallback that cannot carry a family is skipped for that family only,
    // and whatever an earlier apply put in its slot is removed.
    expect(commands).toContain(
      'ip -6 route replace default dev tun1 table 100 metric 101'
    );
    expect(commands).toContain(
      'ip -6 route del default table 100 metric 102 2>/dev/null || true'
    );
    expect(commands).not.toContain(
      'ip -6 route replace default dev tun2 table 100 metric 102'
    );
  });

  test('empties slots a shorter chain no longer uses', () => {
    const commands = buildPlan(
      plan({
        gateways: [
          gateway({
            fallbacks: [
              { interfaceName: 'tun1', present: true, hasIpv6: true },
            ],
            installedMetrics: { v4: [100, 101, 102, 103, 200], v6: [100, 200] },
          }),
        ],
      })
    );

    // Metrics 102 and 103 are leftovers of a longer chain; 100, 101 and 200
    // are wanted and replaced in place, never deleted.
    expect(commands).toContain(
      'ip -4 route del default table 100 metric 102 2>/dev/null || true'
    );
    expect(commands).toContain(
      'ip -4 route del default table 100 metric 103 2>/dev/null || true'
    );
    for (const metric of [100, 101, 200]) {
      expect(commands).not.toContain(
        `ip -4 route del default table 100 metric ${metric} 2>/dev/null || true`
      );
    }
    expect(commands.some((c) => c.includes('ip -6 route del'))).toBe(false);
  });

  test('blackholes IPv6 through a gateway that has no IPv6 address', () => {
    const commands = buildPlan(
      plan({ gateways: [gateway({ hasIpv6: false })] })
    );

    // IPv4 is unaffected...
    expect(commands).toContain(
      'ip -4 route replace default dev tun0 table 100 metric 100'
    );

    // ...while IPv6 is discarded rather than routed. The kernel accepts a v6
    // route through a v4-only interface and then sources the packets from a
    // link-local address, which the far end drops with nothing logged
    // anywhere.
    expect(commands).toContain(
      'ip -6 route replace blackhole default table 100 metric 200'
    );
    expect(commands).not.toContain(
      'ip -6 route replace default dev tun0 table 100 metric 100'
    );
    // ...and one left over from when the interface still had an address goes.
    expect(commands).toContain(
      'ip -6 route del default table 100 metric 100 2>/dev/null || true'
    );

    // Nothing is masqueraded or clamped for a family that cannot be carried.
    expect(
      commands.some(
        (c) => c.startsWith('ip6tables') && c.includes('MASQUERADE')
      )
    ).toBe(false);
    expect(
      commands.some(
        (c) => c.startsWith('ip6tables') && c.includes('--clamp-mss-to-pmtu')
      )
    ).toBe(false);
    expect(
      commands.some((c) => c.startsWith('iptables') && c.includes('MASQUERADE'))
    ).toBe(true);
  });

  test('gives each gateway its own priority', () => {
    const commands = buildPlan(
      plan({
        gateways: [
          gateway(),
          gateway({ interfaceName: 'wg1', fwmark: '0x101', routeTable: 101 }),
        ],
      })
    );

    expect(commands).toContain(
      'ip -4 rule add fwmark 0x100/0xffff priority 100 table 100'
    );
    expect(commands).toContain(
      'ip -4 rule add fwmark 0x101/0xffff priority 101 table 101'
    );
  });
});

describe('buildPlan: direct and block', () => {
  test('sends the direct mark to the main table', () => {
    const commands = buildPlan(populated());
    expect(
      commands.some(
        (c) =>
          c.includes(`fwmark ${MARK_DIRECT}/0xffff`) && c.endsWith('table main')
      )
    ).toBe(true);
  });

  test('blocks with a blackhole route, never a FORWARD drop', () => {
    const commands = buildPlan(populated());

    expect(commands).toContain(
      `ip -4 route replace blackhole default table ${BLOCK_TABLE}`
    );
    expect(
      commands.some((c) => c.includes(`fwmark ${MARK_BLOCK}/0xffff`))
    ).toBe(true);

    // A DROP appended to FORWARD would be unreachable behind wg-easy's own
    // client firewall chain, which is inserted at position 1 on every rebuild.
    expect(commands.some((c) => c.includes('-j DROP'))).toBe(false);
  });

  test('sit past the gateway band at fixed priorities', () => {
    const commands = buildPlan(populated());

    // Fixed, like a gateway's priority equals its table: a rule that reads the
    // same on every apply is one an apply can leave alone.
    expect(commands).toContain(
      `ip -4 rule add fwmark ${MARK_DIRECT}/0xffff priority ${RULE_PRIORITY_DIRECT} table main`
    );
    expect(commands).toContain(
      `ip -4 rule add fwmark ${MARK_BLOCK}/0xffff priority ${RULE_PRIORITY_BLOCK} table ${BLOCK_TABLE}`
    );
  });
});

describe('buildPlan: port forwards', () => {
  const forward = {
    externalPort: 34000,
    internalPort: 22,
    protocols: ['tcp'] as const,
    clientIpv4: '10.8.0.4',
    clientIpv6: 'fdcc:ad94::4',
  };

  const forwardChain = (commands: string[], table = 'iptables') =>
    commands.filter(
      (c) =>
        c.startsWith(`${table} -t nat -A ${CHAIN_FORWARD} `) && !isTeardown(c)
    );

  test('returns traffic from the tunnel and every gateway before any DNAT', () => {
    const commands = forwardChain(
      buildPlan(
        plan({
          forwards: [forward],
          gateways: [
            gateway(),
            gateway({ interfaceName: 'wg1', fwmark: '0x101', routeTable: 101 }),
          ],
        })
      )
    );

    // Without these, a client connecting to any host on a forwarded port would
    // be DNAT'd to the forward's target, and packets from the upstream provider
    // would reach client ports the published range was meant to gate.
    expect(commands[0]).toBe(
      `iptables -t nat -A ${CHAIN_FORWARD} -i wg0 -j RETURN`
    );
    expect(commands[1]).toBe(
      `iptables -t nat -A ${CHAIN_FORWARD} -i tun0 -j RETURN`
    );
    expect(commands[2]).toBe(
      `iptables -t nat -A ${CHAIN_FORWARD} -i wg1 -j RETURN`
    );
    expect(commands.findIndex((c) => c.includes('-j DNAT'))).toBeGreaterThan(2);
  });

  test('marks the connection before translating it', () => {
    const commands = forwardChain(
      buildPlan(plan({ forwards: [forward] }))
    ).filter((c) => !c.endsWith('-j RETURN'));

    // The CONNMARK has to be installed for the connection the DNAT creates, so
    // it must come first; otherwise replies carry no mark and the mangle chain
    // reroutes them out a gateway, silently breaking the forward.
    expect(commands[0]).toContain(
      `-j CONNMARK --set-xmark ${FORWARD_CONNMARK}/${FORWARD_CONNMARK}`
    );
    expect(commands[1]).toContain('-j DNAT --to-destination 10.8.0.4:22');
    expect(commands[0]).toContain('-p tcp --dport 34000');
  });

  test('expands both protocols into separate rules', () => {
    const commands = buildPlan(
      plan({ forwards: [{ ...forward, protocols: ['tcp', 'udp'] }] })
    ).filter((c) => c.includes('-j DNAT'));

    expect(commands.filter((c) => c.includes('-p tcp'))).toHaveLength(2);
    expect(commands.filter((c) => c.includes('-p udp'))).toHaveLength(2);
  });

  test('brackets the address for IPv6', () => {
    const commands = buildPlan(plan({ forwards: [forward] }));
    expect(
      commands.some((c) => c.includes('--to-destination [fdcc:ad94::4]:22'))
    ).toBe(true);
  });

  test('skips a family the client has no address in', () => {
    const commands = buildPlan(
      plan({ forwards: [{ ...forward, clientIpv6: null }] })
    );

    expect(
      commands.some((c) => c.startsWith('ip6tables') && c.includes('-j DNAT'))
    ).toBe(false);
  });

  test('ends the connections of a forward that is no longer installed', () => {
    const commands = buildPlan(
      plan({ forwards: [], staleForwards: [forward] })
    );
    const ended = commands.filter((c) => c.includes('conntrack'));

    // Only the forwarded connections, told apart by the mark the DNAT rule
    // set; a client's own connection to port 34000 somewhere keeps its entry.
    expect(ended).toEqual([
      `conntrack -f ipv4 -D -p tcp --orig-port-dst 34000 -m ${FORWARD_CONNMARK}/${FORWARD_CONNMARK} 2>/dev/null || true`,
      `conntrack -f ipv6 -D -p tcp --orig-port-dst 34000 -m ${FORWARD_CONNMARK}/${FORWARD_CONNMARK} 2>/dev/null || true`,
    ]);
    // Deleting an entry before the chain is replaced would let the old rule
    // re-create it on the next packet.
    expect(commands.indexOf(ended[0]!)).toBeGreaterThan(
      commands.findIndex((c) => c.includes(`-A ${CHAIN_FORWARD} `))
    );
  });

  test('ends nothing when no forward went away', () => {
    const commands = buildPlan(plan({ forwards: [forward] }));
    expect(commands.some((c) => c.includes('conntrack'))).toBe(false);
  });

  test('ends connections on teardown too', () => {
    const commands = buildPlan(plan({ staleForwards: [forward] }));
    expect(isEmpty(plan({ staleForwards: [forward] }))).toBe(true);
    expect(commands.some((c) => c.includes('conntrack'))).toBe(true);
  });
});

describe('staleForwards', () => {
  const forward = {
    externalPort: 34000,
    internalPort: 22,
    protocols: ['tcp', 'udp'] as const,
    clientIpv4: '10.8.0.4',
    clientIpv6: 'fdcc:ad94::4',
  };

  test('nothing when the forwards are unchanged', () => {
    expect(staleForwards([forward], [forward])).toEqual([]);
  });

  test('a forward that went away, whole', () => {
    expect(staleForwards([forward], [])).toEqual([forward]);
  });

  test('only the protocol a forward was narrowed away from', () => {
    expect(
      staleForwards([forward], [{ ...forward, protocols: ['tcp'] }])
    ).toEqual([{ ...forward, protocols: ['udp'] }]);
  });

  test('a forward pointed at another client, or port, counts as gone', () => {
    // The old client's sessions would keep being translated to it otherwise.
    expect(
      staleForwards([forward], [{ ...forward, clientIpv4: '10.8.0.5' }])
    ).toEqual([forward]);
    expect(
      staleForwards([forward], [{ ...forward, internalPort: 2222 }])
    ).toEqual([forward]);
  });

  test('a new forward is not stale, and nothing is stale on first apply', () => {
    expect(staleForwards([], [forward])).toEqual([]);
  });
});

describe('buildPlan: chains', () => {
  const chains = [
    [CHAIN_MANGLE, 'mangle', 'PREROUTING', ' -i wg0'],
    [CHAIN_MSS, 'mangle', 'FORWARD', ''],
    [CHAIN_NAT, 'nat', 'POSTROUTING', ''],
    [CHAIN_FORWARD, 'nat', 'PREROUTING', ''],
  ] as const;

  test('replaces chain contents in one restore per table, never piecemeal', () => {
    const steps = buildSteps(populated());

    // Flushing and refilling a live chain rule by rule leaves packets
    // unmarked meanwhile: a "block" lets them through and a gateway's
    // connections leave by the wrong path.
    const commands = steps.flatMap((step) =>
      'command' in step ? [step.command] : []
    );
    expect(
      commands.filter(
        (c) => / -[FXN] WG_ROUTER/.test(c) || c.includes(' -A WG_ROUTER')
      )
    ).toEqual([]);

    const restores = steps.flatMap((step) =>
      'restore' in step ? [step.restore] : []
    );
    expect(
      restores.map(
        (r) =>
          `${r.iptables} ${r.table}: ${r.chains.map((c) => c.name).join(' ')}`
      )
    ).toEqual([
      `iptables nat: ${CHAIN_NAT} ${CHAIN_FORWARD}`,
      `ip6tables nat: ${CHAIN_NAT} ${CHAIN_FORWARD}`,
      `iptables mangle: ${CHAIN_MANGLE} ${CHAIN_MSS}`,
      `ip6tables mangle: ${CHAIN_MANGLE} ${CHAIN_MSS}`,
    ]);
  });

  test('attaches each chain once, checking before it appends', () => {
    const commands = buildPlan(populated());

    for (const [chain, table, parent, match] of chains) {
      const jump = `${parent}${match} -j ${chain}`;
      // The jump stays put across applies; only the chain's contents change.
      expect(commands).toContain(
        `iptables -t ${table} -C ${jump} 2>/dev/null || iptables -t ${table} -A ${jump}`
      );
    }
  });

  test('detaches with the exact specification, every duplicate, on teardown', () => {
    const commands = buildPlan(plan());

    for (const [chain, table, parent, match] of chains) {
      // `iptables -D` only removes a rule whose specification matches
      // exactly; a detach missing the `-i wg0` would never match.
      const detach = commands.find((c) =>
        c.includes(`iptables -t ${table} -D ${parent}${match} -j ${chain}`)
      );
      expect(detach).toMatch(/^while .*; do :; done/);
    }
  });

  test('renders a restore that declares, fills and commits its chains', () => {
    expect(
      renderRestore({
        iptables: 'iptables',
        table: 'nat',
        chains: [
          { name: 'A', rules: ['-o tun0 -j MASQUERADE'] },
          { name: 'B', rules: [] },
        ],
      })
    ).toBe(
      '*nat\n:A - [0:0]\n:B - [0:0]\n-A A -o tun0 -j MASQUERADE\nCOMMIT\n'
    );
  });

  test('marks removals as tolerable failures and creations as not', () => {
    const commands = buildPlan(populated());

    for (const command of commands) {
      const removes = /^while | -[DFX] | rule del | route (flush|del) /.test(
        command
      );
      expect(isTeardown(command)).toBe(removes);
    }
  });
});

describe('buildPlan: previously installed rules', () => {
  const installed = (v4: InstalledRule[], v6: InstalledRule[] = []) =>
    plan({ gateways: [gateway()], installedRules: { v4, v6 } });

  test('leaves a rule that is already right alone', () => {
    const commands = buildPlan(
      installed([{ priority: 100, fwmark: '0x100/0xffff', table: '100' }])
    );

    // Neither deleted nor re-added: recreating it would leave a moment with no
    // rule at all, during which that gateway's traffic falls through to main.
    expect(commands.some((c) => c.includes('ip -4 rule del'))).toBe(false);
    expect(commands).not.toContain(
      'ip -4 rule add fwmark 0x100/0xffff priority 100 table 100'
    );
    // The other family had nothing installed, so there it is added.
    expect(commands).toContain(
      'ip -6 rule add fwmark 0x100/0xffff priority 100 table 100'
    );
  });

  test('removes a stale rule only after its successor and the chains', () => {
    const commands = buildPlan(
      installed([], [{ priority: 101, fwmark: '0xddd/0xffff', table: 'main' }])
    );

    // By specification, never by bare priority: another process in this
    // namespace may legitimately own a rule at the same preference.
    const removed = commands.findIndex((c) =>
      c.includes('ip -6 rule del priority 101 fwmark 0xddd/0xffff table main')
    );
    const added = commands.indexOf(
      `ip -6 rule add fwmark 0xddd/0xffff priority ${RULE_PRIORITY_DIRECT} table main`
    );
    const chain = commands.findIndex((c) => c.includes(`-N ${CHAIN_MANGLE}`));

    expect(added).toBeGreaterThanOrEqual(0);
    expect(removed).toBeGreaterThan(added);
    expect(removed).toBeGreaterThan(chain);
    expect(commands[removed]).toMatch(/^while /);
    // main is not ours to empty, whatever pointed at it.
    expect(commands.some((c) => c.includes('route flush table main'))).toBe(
      false
    );
  });

  test('empties the table of a gateway that is gone, and no other', () => {
    const commands = buildPlan(
      installed([{ priority: 101, fwmark: '0x101/0xffff', table: '101' }])
    );

    const removed = commands.findIndex((c) =>
      c.includes('ip -4 rule del priority 101 fwmark 0x101/0xffff table 101')
    );
    const flushed = commands.findIndex((c) =>
      c.includes('ip -4 route flush table 101')
    );

    // Rule first, then table: the other way round routes into an empty table
    // for a moment, and an empty table falls through to main.
    expect(removed).toBeGreaterThanOrEqual(0);
    expect(flushed).toBeGreaterThan(removed);
    expect(commands.some((c) => c.includes('route flush table 100'))).toBe(
      false
    );
  });
});

describe('buildPlan: nothing configured', () => {
  test('recognises an unused feature', () => {
    expect(isEmpty(plan())).toBe(true);
    expect(isEmpty(plan({ gateways: [gateway()] }))).toBe(false);
    expect(isEmpty(plan({ rules: [rule()] }))).toBe(false);
    expect(isEmpty(plan({ defaultFwmark: MARK_BLOCK }))).toBe(false);
  });

  test('installs nothing and removes everything', () => {
    const commands = buildPlan(plan());

    // An install that never uses the feature must carry none of it, and
    // removing the last gateway must remove the last trace.
    expect(commands.every(isTeardown)).toBe(true);
    for (const chain of [CHAIN_MANGLE, CHAIN_MSS, CHAIN_NAT, CHAIN_FORWARD]) {
      expect(commands.some((c) => c.includes(`-X ${chain}`))).toBe(true);
      expect(commands.some((c) => c.includes(`-N ${chain}`))).toBe(false);
    }
    expect(
      commands.some((c) => c.includes(`route flush table ${BLOCK_TABLE}`))
    ).toBe(true);
  });

  test('removes the rules found installed and empties their tables', () => {
    const commands = buildPlan(
      plan({
        installedRules: {
          v4: [
            { priority: 100, fwmark: '0x100/0xffff', table: '100' },
            {
              priority: RULE_PRIORITY_DIRECT,
              fwmark: '0xddd/0xffff',
              table: 'main',
            },
          ],
          v6: [],
        },
      })
    );

    // The gateways are gone from the plan by now; the rules found installed
    // are the only record of which tables were in use.
    expect(
      commands.some((c) =>
        c.includes('ip -4 rule del priority 100 fwmark 0x100/0xffff table 100')
      )
    ).toBe(true);
    expect(
      commands.some((c) => c.includes('ip -4 route flush table 100'))
    ).toBe(true);
    expect(commands.some((c) => c.includes('route flush table main'))).toBe(
      false
    );
    expect(commands.every(isTeardown)).toBe(true);
  });
});

describe('buildPlan: IPv6', () => {
  test('emits nothing for IPv6 when it is disabled', () => {
    const commands = buildPlan(
      plan({
        enableIpv6: false,
        rules: [rule({ id: 1 })],
        gateways: [gateway()],
      })
    );

    expect(commands.some((c) => c.startsWith('ip6tables'))).toBe(false);
    expect(commands.some((c) => c.startsWith('ip -6'))).toBe(false);
  });
});
