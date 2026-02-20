import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Prisma } from '@prisma/client';

type PrismaHttpError = {
  statusCode: number;
  message: string;
};

@Catch(
  Prisma.PrismaClientKnownRequestError,
  Prisma.PrismaClientUnknownRequestError,
  Prisma.PrismaClientValidationError,
  Prisma.PrismaClientInitializationError,
  Prisma.PrismaClientRustPanicError,
)
export class PrismaExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(PrismaExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const { statusCode, message } = this.mapException(exception);

    this.logger.warn(
      `Prisma error on ${request?.method ?? 'UNKNOWN'} ${request?.url ?? 'UNKNOWN'}: ${message}`,
    );

    response.status(statusCode).json({
      statusCode,
      message,
      error: HttpStatus[statusCode] ?? 'Error',
      path: request?.url ?? '',
      timestamp: new Date().toISOString(),
    });
  }

  private mapException(exception: unknown): PrismaHttpError {
    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      switch (exception.code) {
        case 'P2002':
          return {
            statusCode: HttpStatus.CONFLICT,
            message: 'A record with the same unique value already exists.',
          };
        case 'P2003':
          return {
            statusCode: HttpStatus.CONFLICT,
            message: 'Operation failed due to related data constraints.',
          };
        case 'P2014':
          return {
            statusCode: HttpStatus.CONFLICT,
            message: 'Operation failed due to relation constraints.',
          };
        case 'P2025':
          return {
            statusCode: HttpStatus.NOT_FOUND,
            message: 'Requested resource was not found.',
          };
        default:
          return {
            statusCode: HttpStatus.BAD_REQUEST,
            message: 'Database request failed.',
          };
      }
    }

    if (exception instanceof Prisma.PrismaClientValidationError) {
      return {
        statusCode: HttpStatus.BAD_REQUEST,
        message: 'Invalid database query or data payload.',
      };
    }

    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'An unexpected database error occurred.',
    };
  }
}
