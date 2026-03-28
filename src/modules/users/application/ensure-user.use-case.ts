import type { User } from '@prisma/client';
import type { UserRepository } from '../infra/user.repository.js';

export class EnsureUserUseCase {
  constructor(private readonly users: UserRepository) {}

  async execute(params: {
    whatsappNumber: string;
    displayName?: string | null;
    timezone?: string;
    locale?: string;
  }): Promise<User> {
    const existing = await this.users.findByWhatsappNumber(params.whatsappNumber);
    if (existing) {
      return existing;
    }
    return this.users.create({
      whatsappNumber: params.whatsappNumber,
      displayName: params.displayName,
      timezone: params.timezone,
      locale: params.locale,
    });
  }
}
