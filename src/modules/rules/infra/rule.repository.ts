import type { Rule } from '@prisma/client';
import { prisma } from '../../../shared/infra/prisma.js';

export class RuleRepository {
  async listActiveForUser(userId: string): Promise<Rule[]> {
    return prisma.rule.findMany({
      where: { userId, isActive: true },
      orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
    });
  }
}
