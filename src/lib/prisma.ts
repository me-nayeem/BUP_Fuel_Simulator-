import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@/generated/prisma/client';
import { config } from '@/lib/config';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export function getPrisma(): PrismaClient | null {
  if (!config.DATABASE_URL) return null;
  globalForPrisma.prisma ??= new PrismaClient({
    adapter: new PrismaPg({ connectionString: config.DATABASE_URL }),
  });
  return globalForPrisma.prisma;
}

export async function pingDatabase(
  timeoutMs = 1000,
): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const prisma = getPrisma();
  if (!prisma) return { ok: false, latencyMs: 0, error: 'DATABASE_URL not configured' };

  const started = performance.now();
  try {
    await Promise.race([
      prisma.$queryRaw`SELECT 1`,
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs)),
    ]);
    return { ok: true, latencyMs: Math.round(performance.now() - started) };
  } catch (error) {
    return {
      ok: false,
      latencyMs: Math.round(performance.now() - started),
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
