/**
 * The host ports inbound forwards may use.
 *
 * A contract with the compose file rather than ordinary settings: the ports
 * have to match what Docker publishes into the container, and a forward
 * outside them is accepted by the UI and then never receives a packet.
 * Changing them means recreating the container either way, which is why this
 * is environment and not a database field.
 *
 * `ROUTER_FORWARD_PORTS` is a comma-separated list of ports and ranges, such as
 * `34000-34100, 25565`. `ROUTER_FORWARD_PORT_START` and `_END` describe a
 * single range and remain for compose files written against them. Both forms
 * add to the same set; only when neither is given does the default range apply.
 */

export type PortSpec = { start: number; end: number };

const DEFAULT_RANGE: PortSpec = { start: 34000, end: 34100 };

function assertPort(port: number, source: string) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid ${source}: ${port} is not a port`);
  }
}

/** Parse a `34000-34100, 25565` style list. */
export function parseForwardPorts(
  value: string,
  source = 'ROUTER_FORWARD_PORTS'
): PortSpec[] {
  const specs: PortSpec[] = [];

  for (const raw of value.split(',')) {
    const entry = raw.trim();
    if (!entry) continue;

    const match = /^(\d{1,5})(?:\s*-\s*(\d{1,5}))?$/.exec(entry);
    if (!match) {
      throw new Error(
        `Invalid ${source}: "${entry}" is neither a port nor a range`
      );
    }

    const start = Number(match[1]);
    const end = match[2] === undefined ? start : Number(match[2]);
    assertPort(start, source);
    assertPort(end, source);
    if (start > end) {
      throw new Error(`Invalid ${source}: "${entry}" runs backwards`);
    }
    specs.push({ start, end });
  }

  return specs;
}

/** `34000-34100, 25565`, for messages and the routing page. */
export function formatForwardPorts(specs: readonly PortSpec[]) {
  return specs
    .map((spec) =>
      spec.start === spec.end ? `${spec.start}` : `${spec.start}-${spec.end}`
    )
    .join(', ');
}

export function isForwardPortPublished(
  port: number,
  specs: readonly PortSpec[] = ROUTER_ENV.FORWARD_PORTS
) {
  return specs.some((spec) => port >= spec.start && port <= spec.end);
}

/**
 * A misconfigured value is refused rather than silently replaced with the
 * default, matching how `TRUSTED_PROXIES` is handled: a forward that works in
 * the UI and is dead on the wire is the harder problem to find.
 *
 * The default applies only when nothing is declared at all. A list that is
 * set and empty means the container publishes no ports, so a compose file
 * with the port lines removed can say so and have the routing page refuse
 * forwards rather than offer a range that goes nowhere.
 */
export function readForwardPorts(
  env: Record<string, string | undefined> = process.env
): PortSpec[] {
  const specs: PortSpec[] = [];

  const list = env.ROUTER_FORWARD_PORTS;
  if (list) specs.push(...parseForwardPorts(list));

  const start = env.ROUTER_FORWARD_PORT_START;
  const end = env.ROUTER_FORWARD_PORT_END;
  if (start || end) {
    const range = {
      start: start ? Number(start) : DEFAULT_RANGE.start,
      end: end ? Number(end) : DEFAULT_RANGE.end,
    };
    assertPort(range.start, 'ROUTER_FORWARD_PORT_START');
    assertPort(range.end, 'ROUTER_FORWARD_PORT_END');
    if (range.start > range.end) {
      throw new Error(
        `ROUTER_FORWARD_PORT_START (${range.start}) is above ROUTER_FORWARD_PORT_END (${range.end})`
      );
    }
    specs.push(range);
  }

  // In the order declared: the list is shown back to the operator, and the
  // order they chose is the one they will recognise.
  if (specs.length === 0 && list === undefined) specs.push(DEFAULT_RANGE);
  return specs;
}

export const ROUTER_ENV = {
  /** Host ports available for inbound forwards; a single port is a range of one. */
  FORWARD_PORTS: readForwardPorts(),
};
