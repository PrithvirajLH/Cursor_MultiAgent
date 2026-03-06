import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer from 'nodemailer';

@Injectable()
export class EmailService {
  private transporter: nodemailer.Transporter | null = null;
  private fromAddress: string;
  private replyToAddress: string;

  constructor(private readonly config: ConfigService) {
    const host = this.config.get<string>('SMTP_HOST');
    const port = Number(this.config.get<string>('SMTP_PORT') ?? '587');
    const user = this.config.get<string>('SMTP_USER');
    const pass = this.config.get<string>('SMTP_PASS');
    const secure = this.config.get<string>('SMTP_SECURE') === 'true';
    this.fromAddress =
      this.config.get<string>('SMTP_FROM') ?? 'no-reply@localhost';
    this.replyToAddress =
      this.config.get<string>('SMTP_REPLY_TO') ?? this.fromAddress;

    if (host) {
      this.transporter = nodemailer.createTransport({
        host,
        port,
        secure,
        auth: user && pass ? { user, pass } : undefined,
      });
    }
  }

  isConfigured() {
    return Boolean(this.transporter);
  }

  getReplyToAddress() {
    return this.replyToAddress;
  }

  async sendEmail(payload: {
    to: string;
    subject: string;
    text: string;
    html?: string;
    messageId?: string;
    inReplyTo?: string;
    references?: string[];
  }) {
    if (!this.transporter) {
      throw new Error('SMTP not configured');
    }

    await this.transporter.sendMail({
      from: this.fromAddress,
      replyTo: this.replyToAddress,
      to: payload.to,
      subject: payload.subject,
      text: payload.text,
      html: payload.html,
      messageId: payload.messageId,
      inReplyTo: payload.inReplyTo,
      references: payload.references,
    });
  }
}
