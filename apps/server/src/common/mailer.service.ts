import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import * as nodemailer from "nodemailer";

/**
 * 站点级发信能力（与 mail 模块的「用户自带邮箱账户」区分）。
 *
 * 用途：注册验证码等系统通知，走 env 里的全局 SMTP，不依赖任何用户邮箱配置。
 * 未配置 SMTP 时 send() 返回 false，由调用方决定兜底方式（开发态直接回显验证码）。
 */
@Injectable()
export class MailerService {
  private readonly log = new Logger("mailer");
  private readonly cfg = {
    host: process.env.SMTP_HOST ?? "",
    port: Number(process.env.SMTP_PORT ?? 465),
    secure: (process.env.SMTP_SECURE ?? "true") !== "false",
    user: process.env.SMTP_USER ?? "",
    pass: process.env.SMTP_PASS ?? "",
    from: process.env.SMTP_FROM ?? process.env.SMTP_USER ?? "",
  };

  /** 是否具备真实投递条件（host + 账号 + 密码 + 发件人齐全） */
  get configured(): boolean {
    const c = this.cfg;
    return Boolean(c.host && c.user && c.pass && c.from);
  }

  /**
   * 发送纯文本邮件。
   * @returns true = 已通过 SMTP 投递；false = 未配置发信，调用方自行兜底
   */
  async send(to: string, subject: string, text: string): Promise<boolean> {
    if (!this.configured) {
      this.log.warn(`SMTP 未配置（SMTP_HOST/SMTP_USER/SMTP_PASS），跳过发送 → ${to}「${subject}」`);
      return false;
    }
    const transport = nodemailer.createTransport({
      host: this.cfg.host,
      port: this.cfg.port,
      secure: this.cfg.secure,
      auth: { user: this.cfg.user, pass: this.cfg.pass },
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 30_000,
    });
    try {
      await transport.sendMail({
        from: { name: "AI-Workbench", address: this.cfg.from },
        to,
        subject,
        text,
      });
      return true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // 验证码链路不能只说「失败」，把原因带给使用者（多为授权码/端口错误）
      throw new BadRequestException(`验证码邮件发送失败：${msg}`);
    } finally {
      transport.close();
    }
  }
}
