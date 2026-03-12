import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { CacheModule } from '@nestjs/cache-manager';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import path from 'path';
import { AppController } from './app.controller';
import { RouteThrottlerGuard } from './common/route-throttler.guard';
import { AuthModule } from './auth/auth.module';
import { AuditModule } from './audit/audit.module';
import { AutomationModule } from './automation/automation.module';
import { CannedResponsesModule } from './canned-responses/canned-responses.module';
import { CategoriesModule } from './categories/categories.module';
import { CommonModule } from './common/common.module';
import { CustomFieldsModule } from './custom-fields/custom-fields.module';
import { NotificationsModule } from './notifications/notifications.module';
import { PrismaModule } from './prisma/prisma.module';
import { RealtimeModule } from './realtime/realtime.module';
import { ReportsModule } from './reports/reports.module';
import { RoutingRulesModule } from './routing/routing.module';
import { SavedViewsModule } from './saved-views/saved-views.module';
import { SlasModule } from './slas/slas.module';
import { TeamsModule } from './teams/teams.module';
import { TicketsModule } from './tickets/tickets.module';
import { UsersModule } from './users/users.module';
import { IdempotencyInterceptor } from './common/idempotency.interceptor';

// Resolve env file from cwd (apps/api) to work in both dev and production builds
const envFile = process.env.NODE_ENV === 'test' ? '.env.test' : '.env';

import { parsePositiveInt } from './common/config.utils';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: path.resolve(process.cwd(), envFile),
    }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => [
        {
          name: 'default',
          ttl: parsePositiveInt(
            config.get<string>('RATE_LIMIT_TTL_MS'),
            60_000,
          ),
          limit: parsePositiveInt(config.get<string>('RATE_LIMIT_LIMIT'), 120),
          setHeaders: true,
        },
      ],
    }),
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const isProd = config.get<string>('NODE_ENV') === 'production';
        return {
          pinoHttp: {
            level: isProd ? 'info' : 'debug',
            transport: isProd
              ? undefined
              : {
                  target: 'pino-pretty',
                  options: {
                    singleLine: true,
                  },
                },
          },
        };
      },
    }),
    CacheModule.registerAsync({
      isGlobal: true,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const ttl = parsePositiveInt(
          config.get<string>('CACHE_SUMMARY_TTL_MS'),
          45_000,
        );
        return { ttl };
      },
    }),
    AuthModule,
    AuditModule,
    AutomationModule,
    CannedResponsesModule,
    CategoriesModule,
    CommonModule,
    CustomFieldsModule,
    NotificationsModule,
    PrismaModule,
    RealtimeModule,
    ReportsModule,
    RoutingRulesModule,
    SavedViewsModule,
    SlasModule,
    TeamsModule,
    TicketsModule,
    UsersModule,
  ],
  controllers: [AppController],
  providers: [
    {
      provide: APP_GUARD,
      useClass: RouteThrottlerGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: IdempotencyInterceptor,
    },
  ],
})
export class AppModule {}
