import type { Prisma } from '@prisma/client';
import { prisma } from '../../../shared/infra/prisma.js';

export class AuditService {
  async log(params: {
    userId?: string | null;
    action: string;
    entityType: string;
    entityId: string;
    before?: Prisma.InputJsonValue | null;
    after?: Prisma.InputJsonValue | null;
  }): Promise<void> {
    await prisma.auditLog.create({
      data: {
        userId: params.userId ?? null,
        action: params.action,
        entityType: params.entityType,
        entityId: params.entityId,
        before: params.before ?? undefined,
        after: params.after ?? undefined,
      },
    });
  }
}
