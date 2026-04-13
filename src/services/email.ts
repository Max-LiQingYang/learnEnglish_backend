import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT) || 587,
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

export async function sendVerificationEmail(email: string, code: string): Promise<void> {
  await transporter.sendMail({
    from: process.env.EMAIL_FROM || 'noreply@learnenglish.app',
    to: email,
    subject: '【Learn English】你的注册验证码',
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
        <h2 style="color: #1a1a1a;">欢迎加入 Learn English！</h2>
        <p style="color: #555; line-height: 1.6;">你的注册验证码如下（10分钟内有效）：</p>
        <div style="background: #F4F6FF; border-radius: 12px; padding: 24px; text-align: center; margin: 24px 0;">
          <span style="font-size: 36px; font-weight: 800; color: #4F6EF7; letter-spacing: 12px;">${code}</span>
        </div>
        <p style="color: #999; font-size: 13px;">请在 App 中输入此验证码完成注册。如非本人操作，请忽略此邮件。</p>
      </div>
    `,
  });
}
