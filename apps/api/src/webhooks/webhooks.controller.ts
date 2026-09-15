import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { OwnerGuard } from '../auth/owner.guard';
import { CreateWebhookSubscriptionDto } from './dto/create-webhook-subscription.dto';
import {
  WebhooksService,
  type CreatedWebhookSubscription,
  type WebhookSubscriptionSummary,
} from './webhooks.service';

/**
 * Outbound webhook subscriptions (card 2.6).
 *
 * ⚠️ OWNER ONLY. Registering a destination points this server at an address of
 * the registrant's choosing; that is a capability, not a preference.
 */
@Controller('admin/webhooks')
@UseGuards(OwnerGuard)
export class WebhooksController {
  constructor(private readonly webhooks: WebhooksService) {}

  /** Every subscription. The signing secret is never included. */
  @Get()
  async list(): Promise<{ data: WebhookSubscriptionSummary[] }> {
    return { data: await this.webhooks.listSubscriptions() };
  }

  /**
   * Register a destination.
   *
   * ⚠️ THE ONLY RESPONSE THAT EVER CONTAINS `secret`. The consumer needs it to
   * verify signatures and it cannot be read back afterwards.
   */
  @Post()
  async create(
    @Body() dto: CreateWebhookSubscriptionDto,
  ): Promise<{ data: CreatedWebhookSubscription }> {
    return {
      data: await this.webhooks.createSubscription({
        url: dto.url,
        events: dto.events,
      }),
    };
  }

  /**
   * Deliveries that exhausted their retries.
   *
   * A webhook that silently stopped delivering is worse than one that never
   * worked, so the dead state is visible rather than only a status column.
   */
  @Get('dead-letters')
  async deadLetters() {
    return { data: await this.webhooks.listDeadDeliveries() };
  }

  /** Stop delivering to a destination, keeping its history. */
  @Delete(':id')
  async deactivate(@Param('id') id: string): Promise<{ data: { id: string } }> {
    return { data: await this.webhooks.deactivateSubscription(id) };
  }
}
