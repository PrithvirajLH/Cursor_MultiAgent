import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient<Prisma.PrismaClientOptions, 'query'>
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    const logQueries = process.env.PRISMA_LOG_QUERIES === 'true';
    super({
      log: logQueries ? [{ emit: 'event', level: 'query' }] : [],
    });

    if (logQueries) {
      const slowThreshold = Number(process.env.PRISMA_SLOW_QUERY_MS ?? '200');
      const maxQueryLength = Number(process.env.PRISMA_QUERY_MAX_LEN ?? '200');
      this.$on('query', (event: Prisma.QueryEvent) => {
        if (event.duration < slowThreshold) return;
        const query = event.query.length > maxQueryLength
          ? `${event.query.slice(0, maxQueryLength)}…`
          : event.query;
        console.log(
          `[prisma] ${event.duration}ms ${event.target} :: ${query}`
        );
      });
    }
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
