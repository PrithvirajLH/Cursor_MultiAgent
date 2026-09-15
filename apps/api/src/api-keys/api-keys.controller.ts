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
import { ApiKeysService, type ApiKeySummary, type IssuedApiKey } from './api-keys.service';
import { CreateApiKeyDto } from './dto/create-api-key.dto';

/**
 * Issuing and revoking machine credentials (card 2.6).
 *
 * ⚠️ OWNER ONLY. A key is a credential that acts as a user; handing out the
 * ability to mint them is handing out the ability to create access, so it sits
 * with the role that already administers everything rather than with team
 * admins.
 */
@Controller('admin/api-keys')
@UseGuards(OwnerGuard)
export class ApiKeysController {
  constructor(private readonly apiKeys: ApiKeysService) {}

  /** Every key, live and revoked. The secret is never included. */
  @Get()
  async list(): Promise<{ data: ApiKeySummary[] }> {
    return { data: await this.apiKeys.list() };
  }

  /**
   * Mint a key.
   *
   * ⚠️ THE ONLY RESPONSE THAT EVER CONTAINS `key`. It is not stored in a
   * readable form, so it cannot be shown again; the screen must tell the person
   * to copy it now.
   */
  @Post()
  async create(@Body() dto: CreateApiKeyDto): Promise<{ data: IssuedApiKey }> {
    return {
      data: await this.apiKeys.create({
        name: dto.name,
        serviceUserId: dto.serviceUserId,
        teamScope: dto.teamScope ?? null,
      }),
    };
  }

  /** Revoke a key. Effective on the next request, with no cache to wait out. */
  @Delete(':id')
  async revoke(
    @Param('id') id: string,
  ): Promise<{ data: { id: string; revokedAt: Date } }> {
    return { data: await this.apiKeys.revoke(id) };
  }
}
