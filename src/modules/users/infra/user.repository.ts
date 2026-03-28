import type { User } from '@prisma/client';
import { prisma } from '../../../shared/infra/prisma.js';

export class UserRepository {
  async findByWhatsappNumber(whatsappNumber: string): Promise<User | null> {
    return prisma.user.findUnique({ where: { whatsappNumber } });
  }

  async create(data: {
    whatsappNumber: string;
    displayName?: string | null;
    timezone?: string;
    locale?: string;
  }): Promise<User> {
    return prisma.user.create({
      data: {
        whatsappNumber: data.whatsappNumber,
        displayName: data.displayName ?? null,
        timezone: data.timezone ?? 'America/Sao_Paulo',
        locale: data.locale ?? 'pt-BR',
      },
    });
  }

  async getById(id: string): Promise<User | null> {
    return prisma.user.findUnique({ where: { id } });
  }
}
