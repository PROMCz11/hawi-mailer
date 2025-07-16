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

    async sendNotification(
        tokens: string[],
        title: string,
        body: string,
        data: Record<string, string> = {}
    ) {
        if (!tokens || tokens.length === 0) {
            throw new Error('No FCM tokens provided');
        }

        const message: MulticastMessage = {
            tokens,
            notification: { title, body },
            data,
        };

        const response = await this.messaging.sendEachForMulticast(message);

        return {
            successCount: response.successCount,
            failureCount: response.failureCount
        };
    }
}