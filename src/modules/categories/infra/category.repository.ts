import type { Category, Prisma } from '@prisma/client';
import { prisma } from '../../../shared/infra/prisma.js';

export class CategoryRepository {
  async listSystem(): Promise<Category[]> {
    return prisma.category.findMany({
      where: { isSystem: true, userId: null },
      orderBy: { name: 'asc' },
    });
  }

  async listForUser(userId: string): Promise<Category[]> {
    return prisma.category.findMany({
      where: {
        OR: [{ userId: null, isSystem: true }, { userId }],
      },
      orderBy: { name: 'asc' },
    });
  }

  async findByNormalizedName(
    userId: string | null,
    normalizedName: string,
  ): Promise<Category | null> {
    return prisma.category.findFirst({
      where: {
        normalizedName,
        OR: [{ userId: null, isSystem: true }, ...(userId ? [{ userId }] : [])],
      },
    });
  }

  async createUserCategory(data: Prisma.CategoryCreateInput): Promise<Category> {
    return prisma.category.create({ data });
  }
}
