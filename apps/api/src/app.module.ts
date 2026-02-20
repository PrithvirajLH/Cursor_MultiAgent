import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import path from 'path';
import { AppController } from './app.controller';
import { AuthModule } from './auth/auth.module';
import { AuditModule } from './audit/audit.module';
import { AutomationModule } from './automation/automation.module';
import { CannedResponsesModule } from './canned-responses/canned-responses.module';
import { CategoriesModule } from './categories/categories.module';
import { CommonModule } from './common/common.module';
import { CustomFieldsModule } from './custom-fields/custom-fields.module';
import { NotificationsModule } from './notifications/notifications.module';
import { PrismaModule } from './prisma/prisma.module';
import { ReportsModule } from './reports/reports.module';
import { RoutingRulesModule } from './routing/routing.module';
import { SavedViewsModule } from './saved-views/saved-views.module';
import { SlasModule } from './slas/slas.module';
import { TeamsModule } from './teams/teams.module';
import { TicketsModule } from './tickets/tickets.module';
import { UsersModule } from './users/users.module';

// Resolve env file from cwd (apps/api) to work in both dev and production builds
const envFile = process.env.NODE_ENV === 'test' ? '.env.test' : '.env';

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

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
          ttl: parsePositiveInt(
            config.get<string>('RATE_LIMIT_TTL_MS'),
            60_000,
          ),
          limit: parsePositiveInt(config.get<string>('RATE_LIMIT_LIMIT'), 120),
          setHeaders: true,
        },
      ],
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
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
