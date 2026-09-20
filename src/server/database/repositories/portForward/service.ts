import { and, asc, eq, inArray, ne } from 'drizzle-orm';

import { portForward } from './schema';
import { conflictingProtocols } from './types';
import type {
  PortForwardCreateType,
  PortForwardUpdateType,
  Protocol,
} from './types';

import type { ID } from '#server/utils/types';
import type { DBType } from '#db/sqlite';

type TxType = Parameters<Parameters<DBType['transaction']>[0]>[0];

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

function createPreparedStatement(db: DBType) {
  return {
    findAll: db.query.portForward
      .findMany({ orderBy: asc(portForward.externalPort), with: withClient })
      .prepare(),
  };
}

/** The forward already holding an external port for a protocol. */
export type ForwardConflict = { id: number; name: string; protocol: string };

export class PortForwardService {
  #db: DBType;
  #statements: ReturnType<typeof createPreparedStatement>;

  constructor(db: DBType) {
    this.#db = db;
    this.#statements = createPreparedStatement(db);
  }

  getAll() {
    return this.#statements.findAll.execute();
  }

  get(id: ID) {
    return this.#db.query.portForward.findFirst({
      where: eq(portForward.id, id),
      with: withClient,
    });
  }

  /**
   * @param excludeId the forward being edited, so it does not conflict with
   * itself
   */
  async #findConflict(
    tx: TxType,
    externalPort: number,
    protocol: Protocol,
    excludeId?: ID
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

  /**
   * Create a forward unless its port is taken. Checked and written in one
   * transaction, since `both` collides with `tcp` and `udp`, which the unique
   * index cannot express.
   *
   * @returns the created forward, or the conflict that prevented it
   */
  create(data: PortForwardCreateType) {
    return this.#db.transaction(async (tx) => {
      const conflict = await this.#findConflict(
        tx,
        data.externalPort,
        data.protocol
      );
      if (conflict) return { conflict };

      const [created] = await tx.insert(portForward).values(data).returning();
      return { created: created! };
    });
  }

  update(id: ID, data: PortForwardUpdateType) {
    return this.#db.transaction(async (tx) => {
      const conflict = await this.#findConflict(
        tx,
        data.externalPort,
        data.protocol,
        id
      );
      if (conflict) return { conflict };

      await tx.update(portForward).set(data).where(eq(portForward.id, id));
      return { conflict: undefined };
    });
  }

  delete(id: ID) {
    return this.#db.delete(portForward).where(eq(portForward.id, id)).execute();
  }
}
