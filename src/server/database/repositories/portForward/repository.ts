import { and, asc, eq, inArray, ne } from 'drizzle-orm';

import { portForward } from './schema';
import { conflictingProtocols } from './types';
import type {
  PortForwardCreateType,
  PortForwardUpdateType,
  Protocol,
} from './types';

import type { DBExecutor } from '#db/types';

const withClient = {
  client: {
    columns: {
      id: true,
      name: true,
      ipv4Address: true,
      ipv6Address: true,
      enabled: true,
    },
  },
} as const;

/** The forward already holding an external port for a protocol. */
export type ForwardConflict = { id: number; name: string; protocol: string };

/**
 * @param excludeId the forward being edited, so it does not conflict with
 * itself
 */
async function findConflict(
  tx: DBExecutor,
  externalPort: number,
  protocol: Protocol,
  excludeId?: number
): Promise<ForwardConflict | undefined> {
  const [conflict] = await tx
    .select({
      id: portForward.id,
      name: portForward.name,
      protocol: portForward.protocol,
    })
    .from(portForward)
    .where(
      and(
        eq(portForward.externalPort, externalPort),
        inArray(portForward.protocol, conflictingProtocols(protocol)),
        excludeId === undefined ? undefined : ne(portForward.id, excludeId)
      )
    )
    .limit(1);

  return conflict;
}

export class PortForwardRepository {
  constructor(private readonly db: DBExecutor) {}

  async getAll() {
    return this.db.query.portForward.findMany({
      orderBy: asc(portForward.externalPort),
      with: withClient,
    });
  }

  async get(id: number) {
    return this.db.query.portForward.findFirst({
      where: eq(portForward.id, id),
      with: withClient,
    });
  }

  /**
   * Create a forward unless its port is taken. Checked and written in one
   * transaction, since `both` collides with `tcp` and `udp`, which the unique
   * index cannot express.
   *
   * @returns the created forward, or the conflict that prevented it
   */
  async create(data: PortForwardCreateType) {
    return this.db.transaction(async (tx) => {
      const conflict = await findConflict(tx, data.externalPort, data.protocol);
      if (conflict) {
        return { conflict };
      }

      const [created] = await tx.insert(portForward).values(data).returning();
      return { created: created! };
    });
  }

  async update(id: number, data: PortForwardUpdateType) {
    return this.db.transaction(async (tx) => {
      const conflict = await findConflict(
        tx,
        data.externalPort,
        data.protocol,
        id
      );
      if (conflict) {
        return { conflict };
      }

      await tx.update(portForward).set(data).where(eq(portForward.id, id));
      return { conflict: undefined };
    });
  }

  async delete(id: number) {
    return this.db.delete(portForward).where(eq(portForward.id, id));
  }
}
