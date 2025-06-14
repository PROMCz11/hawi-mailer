import { Injectable } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

@Injectable()
export class MailService {
    private transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: process.env.GMAIL_USER,
            pass: process.env.GMAIL_PASS,
        },
    });

    async sendOtp(to: string, otp: string) {
        const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Verification Code</title>
            <style>
                body {
                    font-family: Cairo, sans-serif;
                    background-color: #006564;
                    margin: 48px 48px 24px;
                    padding: 0;
                    text-align: center;
                }
                .container {
                    max-width: 550px;
                    margin: 0 auto;
                    padding: 24px 16px 32px;
                    background-color: #F8FAFC;
                    border-radius: 16px;
                    box-shadow: 0 4px 15px rgba(0, 0, 0, 0.5);
                    text-align: center;
                }
                .header {
                    color: #333333;
                    font-size: 24px;
                    font-weight: bold;
                    margin-bottom: 16px;
                }
                .greeting {
                    color: #333333;
                    font-size: 14px;
                    margin-bottom: 16px;
                }
                .code-container {
                    background-color: #EAEEF5;
                    border: 1px solid #BCC2CD;
                    border-radius: 6px;
                    padding: 0px 16px;
                    margin: 0 auto;
                    display: inline-block;
                    text-align: center;
                }
                .verification-code {
                    color: #10606E;
                    font-size: 64px;
                    font-weight: bold;
                    letter-spacing: 12px;
                    padding-left: 8px;
                    line-height: 120%;
                    margin: 0 auto;
                }
                .footer {
                    color: #FFFFFF;
                    font-size: 14px;
                    margin-top: 8px;
                    padding: 8px 0;
                }
                .brand {
                    font-weight: bold;
                }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">رمز التأكيد</div>
                <div class="greeting">مرحباً، رمز تفعيل حسابك هو:</div>
                <div class="code-container">
                    <div class="verification-code">${otp}</div>
                </div>
            </div>
            <div class="footer">
                <span class="brand">حاوي - HAWI</span>
            </div>
        </body>
        </html>
        `;

        const info = await this.transporter.sendMail({
            from: `"Hawi's email verification service" <${process.env.GMAIL_USER}>`,
            to,
            subject: 'رمز التأكيد - HAWI',
            html: htmlContent,
        });

        return info;
    }
}