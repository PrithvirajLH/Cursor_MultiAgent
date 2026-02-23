import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AccessControlService } from '../common/access-control.service';
import { PrismaService } from '../prisma/prisma.service';
import { CustomFieldsService } from './custom-fields.service';

describe('CustomFieldsService', () => {
  let service: CustomFieldsService;
  let prisma: PrismaService;

  const teamA = 'team-a-uuid';
  const teamB = 'team-b-uuid';
  const categoryX = 'category-x-uuid';
  const categoryY = 'category-y-uuid';

  const fieldTeamA = {
    id: 'cf-team-a',
    name: 'Asset Tag',
    fieldType: 'TEXT',
    options: null,
    isRequired: true,
    teamId: teamA,
    categoryId: null,
    sortOrder: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const fieldTeamACategoryX = {
    id: 'cf-team-a-cat-x',
    name: 'Software',
    fieldType: 'DROPDOWN',
    options: [
      { value: 'v1', label: 'Option 1' },
      { value: 'v2', label: 'Option 2' },
    ],
    isRequired: false,
    teamId: teamA,
    categoryId: categoryX,
    sortOrder: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const fieldTeamB = {
    id: 'cf-team-b',
    name: 'Other Team Field',
    fieldType: 'TEXT',
    options: null,
    isRequired: false,
    teamId: teamB,
    categoryId: null,
    sortOrder: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CustomFieldsService,
        {
          provide: PrismaService,
          useValue: {
            customField: {
              findMany: jest.fn(),
            },
          },
        },
        {
          provide: AccessControlService,
          useValue: {
            canWriteTicket: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<CustomFieldsService>(CustomFieldsService);
    prisma = module.get<PrismaService>(PrismaService);
    jest.clearAllMocks();
  });

  describe('validateAndNormalizeValuesForTicket', () => {
    it('returns empty array when items is empty', async () => {
      const result = await service.validateAndNormalizeValuesForTicket(
        [],
        teamA,
        null,
      );
      expect(result).toEqual([]);
      expect(
        (prisma.customField.findMany as jest.Mock).mock.calls,
      ).toHaveLength(0);
    });

    it('dedupes by customFieldId and keeps last value', async () => {
      (prisma.customField.findMany as jest.Mock).mockResolvedValue([
        fieldTeamA,
      ]);
      const result = await service.validateAndNormalizeValuesForTicket(
        [
          { customFieldId: fieldTeamA.id, value: 'first' },
          { customFieldId: fieldTeamA.id, value: 'last' },
        ],
        teamA,
        null,
      );
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        customFieldId: fieldTeamA.id,
        value: 'last',
      });
    });

    it('rejects unknown customFieldId with BadRequestException', async () => {
      (prisma.customField.findMany as jest.Mock).mockResolvedValue([]);
      await expect(
        service.validateAndNormalizeValuesForTicket(
          [{ customFieldId: 'unknown-id', value: 'x' }],
          teamA,
          null,
        ),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.validateAndNormalizeValuesForTicket(
          [{ customFieldId: 'unknown-id', value: 'x' }],
          teamA,
          null,
        ),
      ).rejects.toThrow(/Unknown custom field/);
    });

    it('rejects field that does not belong to ticket team with ForbiddenException', async () => {
      (prisma.customField.findMany as jest.Mock).mockResolvedValue([
        fieldTeamB,
      ]);
      await expect(
        service.validateAndNormalizeValuesForTicket(
          [{ customFieldId: fieldTeamB.id, value: 'x' }],
          teamA,
          null,
        ),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        service.validateAndNormalizeValuesForTicket(
          [{ customFieldId: fieldTeamB.id, value: 'x' }],
          teamA,
          null,
        ),
      ).rejects.toThrow(/does not apply to this ticket's team/);
    });

    it('rejects field that does not belong to ticket category with ForbiddenException', async () => {
      (prisma.customField.findMany as jest.Mock).mockResolvedValue([
        fieldTeamACategoryX,
      ]);
      await expect(
        service.validateAndNormalizeValuesForTicket(
          [{ customFieldId: fieldTeamACategoryX.id, value: 'v1' }],
          teamA,
          categoryY,
        ),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        service.validateAndNormalizeValuesForTicket(
          [{ customFieldId: fieldTeamACategoryX.id, value: 'v1' }],
          teamA,
          categoryY,
        ),
      ).rejects.toThrow(/does not apply to this ticket's category/);
    });

    it('rejects empty value for required field with BadRequestException', async () => {
      (prisma.customField.findMany as jest.Mock).mockResolvedValue([
        fieldTeamA,
      ]);
      await expect(
        service.validateAndNormalizeValuesForTicket(
          [{ customFieldId: fieldTeamA.id, value: '' }],
          teamA,
          null,
        ),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.validateAndNormalizeValuesForTicket(
          [{ customFieldId: fieldTeamA.id, value: null }],
          teamA,
          null,
        ),
      ).rejects.toThrow(/Required custom field/);
    });

    it('accepts field scoped to team (teamId match, categoryId null on field)', async () => {
      (prisma.customField.findMany as jest.Mock).mockResolvedValue([
        fieldTeamA,
      ]);
      const result = await service.validateAndNormalizeValuesForTicket(
        [{ customFieldId: fieldTeamA.id, value: 'TAG-001' }],
        teamA,
        null,
      );
      expect(result).toEqual([
        { customFieldId: fieldTeamA.id, value: 'TAG-001' },
      ]);
    });

    it('accepts category-scoped field when ticket category matches', async () => {
      (prisma.customField.findMany as jest.Mock).mockResolvedValue([
        fieldTeamACategoryX,
      ]);
      const result = await service.validateAndNormalizeValuesForTicket(
        [{ customFieldId: fieldTeamACategoryX.id, value: 'v1' }],
        teamA,
        categoryX,
      );
      expect(result).toEqual([
        { customFieldId: fieldTeamACategoryX.id, value: 'v1' },
      ]);
    });

    it('validates DROPDOWN value against options', async () => {
      (prisma.customField.findMany as jest.Mock).mockResolvedValue([
        fieldTeamACategoryX,
      ]);
      await expect(
        service.validateAndNormalizeValuesForTicket(
          [{ customFieldId: fieldTeamACategoryX.id, value: 'invalid-option' }],
          teamA,
          categoryX,
        ),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.validateAndNormalizeValuesForTicket(
          [{ customFieldId: fieldTeamACategoryX.id, value: 'invalid-option' }],
          teamA,
          categoryX,
        ),
      ).rejects.toThrow(/not in allowed options/);
    });

    it('normalizes CHECKBOX to true/false', async () => {
      const checkboxField = {
        ...fieldTeamA,
        id: 'cf-cb',
        fieldType: 'CHECKBOX',
        isRequired: false,
      };
      (prisma.customField.findMany as jest.Mock).mockResolvedValue([
        checkboxField,
      ]);
      const result = await service.validateAndNormalizeValuesForTicket(
        [{ customFieldId: checkboxField.id, value: 'yes' }],
        teamA,
        null,
      );
      expect(result[0].value).toBe('true');
    });

    it('normalizes NUMBER', async () => {
      const numField = {
        ...fieldTeamA,
        id: 'cf-num',
        fieldType: 'NUMBER',
        isRequired: false,
      };
      (prisma.customField.findMany as jest.Mock).mockResolvedValue([numField]);
      const result = await service.validateAndNormalizeValuesForTicket(
        [{ customFieldId: numField.id, value: '42' }],
        teamA,
        null,
      );
      expect(result[0].value).toBe('42');
    });

    it('rejects invalid NUMBER with BadRequestException', async () => {
      const numField = {
        ...fieldTeamA,
        id: 'cf-num',
        fieldType: 'NUMBER',
        isRequired: false,
      };
      (prisma.customField.findMany as jest.Mock).mockResolvedValue([numField]);
      await expect(
        service.validateAndNormalizeValuesForTicket(
          [{ customFieldId: numField.id, value: 'not-a-number' }],
          teamA,
          null,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('when requireAllRequired: true, rejects if required field is omitted', async () => {
      (prisma.customField.findMany as jest.Mock).mockResolvedValue([
        fieldTeamA,
      ]);
      await expect(
        service.validateAndNormalizeValuesForTicket([], teamA, null, {
          requireAllRequired: true,
        }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.validateAndNormalizeValuesForTicket([], teamA, null, {
          requireAllRequired: true,
        }),
      ).rejects.toThrow(/Required custom field "Asset Tag" must be provided/);
    });

    it('when requireAllRequired: true, accepts when all required fields are provided', async () => {
      (prisma.customField.findMany as jest.Mock)
        .mockResolvedValueOnce([fieldTeamA])
        .mockResolvedValueOnce([fieldTeamA]);
      const result = await service.validateAndNormalizeValuesForTicket(
        [{ customFieldId: fieldTeamA.id, value: 'TAG-001' }],
        teamA,
        null,
        { requireAllRequired: true },
      );
      expect(result).toHaveLength(1);
      expect(result[0].value).toBe('TAG-001');
    });

    it('rejects category-scoped field when ticket categoryId is null with clear message', async () => {
      (prisma.customField.findMany as jest.Mock).mockResolvedValue([
        fieldTeamACategoryX,
      ]);
      await expect(
        service.validateAndNormalizeValuesForTicket(
          [{ customFieldId: fieldTeamACategoryX.id, value: 'v1' }],
          teamA,
          null,
        ),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.validateAndNormalizeValuesForTicket(
          [{ customFieldId: fieldTeamACategoryX.id, value: 'v1' }],
          teamA,
          null,
        ),
      ).rejects.toThrow(/requires the ticket to have a category set/);
    });
  });
});
