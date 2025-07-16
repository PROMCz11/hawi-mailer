import { Injectable, OnModuleInit } from '@nestjs/common';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getMessaging, Messaging, MulticastMessage } from 'firebase-admin/messaging';

@Injectable()
export class FirebaseService implements OnModuleInit {
    private messaging: Messaging;

    onModuleInit() {
        const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
        if (!raw) {
            throw new Error('FIREBASE_SERVICE_ACCOUNT is missing');
        }

        const serviceAccount = JSON.parse(raw);

        if (!getApps().length) {
            initializeApp({
                credential: cert(serviceAccount as any),
            });
        }

        this.messaging = getMessaging();
    }

    private chunkTokens(tokens: string[], chunkSize: number = 500): string[][] {
        const chunks: string[][] = [];
        for (let i = 0; i < tokens.length; i += chunkSize) {
            chunks.push(tokens.slice(i, i + chunkSize));
        }
        return chunks;
    }

    async sendNotification(
        tokens: string[],
        title: string,
        body: string,
        data: Record<string, string> = {}
    ) {
        if (!tokens || tokens.length === 0) {
            throw new Error('No FCM tokens provided');
        }

        const tokenChunks = this.chunkTokens(tokens, 500);

        let totalSuccess = 0;
        let totalFailure = 0;

        for (const chunk of tokenChunks) {
            const message: MulticastMessage = {
                tokens: chunk,
                notification: { title, body },
                data,
            };

            const response = await this.messaging.sendEachForMulticast(message);

            totalSuccess += response.successCount;
            totalFailure += response.failureCount;
        }

        return {
            successCount: totalSuccess,
            failureCount: totalFailure
        };
    }
}