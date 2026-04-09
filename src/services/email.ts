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

export async function sendVerificationEmail(email: string, token: string): Promise<void> {
  const verifyUrl = `${process.env.APP_URL || 'http://localhost:3000'}/api/auth/verify-email?token=${token}`;

  await transporter.sendMail({
    from: process.env.EMAIL_FROM || 'noreply@learnenglish.app',
    to: email,
    subject: '验证你的邮箱 - Learn English',
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
        <h2 style="color: #1a1a1a;">欢迎加入 Learn English！</h2>
        <p style="color: #555; line-height: 1.6;">请点击下方按钮验证你的邮箱地址，完成注册：</p>
        <a href="${verifyUrl}"
           style="display: inline-block; margin: 16px 0; padding: 12px 24px;
                  background: #4F6EF7; color: white; border-radius: 8px;
                  text-decoration: none; font-weight: 600;">
          验证邮箱
        </a>
        <p style="color: #999; font-size: 13px;">链接 24 小时内有效。如非本人操作，请忽略此邮件。</p>
      </div>
    `,
  });
}
