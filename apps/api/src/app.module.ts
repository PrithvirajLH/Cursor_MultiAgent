import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { LOG_REDACTION_PATHS } from './common/log-redaction-paths.util';
import { CacheModule } from '@nestjs/cache-manager';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import path from 'path';
import { AppController } from './app.controller';
import { RouteThrottlerGuard } from './common/route-throttler.guard';
import { AuthModule } from './auth/auth.module';
import { AnnouncementsModule } from './announcements/announcements.module';
import { AuditModule } from './audit/audit.module';
import { AutomationModule } from './automation/automation.module';
import { CannedResponsesModule } from './canned-responses/canned-responses.module';
import { AgentsAdminModule } from './agents-admin/agents-admin.module';
import { CategoriesModule } from './categories/categories.module';
import { KbModule } from './kb/kb.module';
import { CommonModule } from './common/common.module';
import { CustomFieldsModule } from './custom-fields/custom-fields.module';
import { HealthModule } from './health/health.module';
import { InboundMailboxModule } from './inbound-mailbox/inbound-mailbox.module';
import { NotificationsModule } from './notifications/notifications.module';
import { PrismaModule } from './prisma/prisma.module';
import { RealtimeModule } from './realtime/realtime.module';
import { ReportsModule } from './reports/reports.module';
import { OperationsModule } from './operations/operations.module';
import { RetentionModule } from './retention/retention.module';
import { RoutingRulesModule } from './routing/routing.module';
import { SavedViewsModule } from './saved-views/saved-views.module';
import { SlasModule } from './slas/slas.module';
import { TagsModule } from './tags/tags.module';
import { TeamsModule } from './teams/teams.module';
import { TicketsModule } from './tickets/tickets.module';
import { UsersModule } from './users/users.module';
import { IdempotencyInterceptor } from './common/idempotency.interceptor';
import { AiModule } from './ai/ai.module';
import { CsatModule } from './csat/csat.module';
import { EmailActionsModule } from './email-actions/email-actions.module';

// Resolve env file from cwd (apps/api) to work in both dev and production builds
const envFile = process.env.NODE_ENV === 'test' ? '.env.test' : '.env';

import { parsePositiveInt } from './common/config.utils';
import { validateEnv } from './common/env.validation';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: path.resolve(process.cwd(), envFile),
      validate: validateEnv,
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
            // ⚠️ Card 1.54. Without this, pino's default serializer logs every
            // request header - which meant a live bearer token on every
            // authenticated request, and the intake shared secret on every
            // Power Automate call, in a log that ships to Kudu.
            redact: {
              paths: [...LOG_REDACTION_PATHS],
              censor: '[redacted]',
            },
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
    AiModule,
    AnnouncementsModule,
    AuthModule,
    AuditModule,
    AutomationModule,
    CannedResponsesModule,
    CategoriesModule,
    KbModule,
    CommonModule,
    CsatModule,
    EmailActionsModule,
    CustomFieldsModule,
    HealthModule,
    InboundMailboxModule,
    NotificationsModule,
    OperationsModule,
    PrismaModule,
    RealtimeModule,
    ReportsModule,
    RetentionModule,
    RoutingRulesModule,
    SavedViewsModule,
    SlasModule,
    TagsModule,
    AgentsAdminModule,
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
