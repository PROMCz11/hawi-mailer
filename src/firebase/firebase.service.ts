import { Injectable, OnModuleInit } from '@nestjs/common';
import * as admin from 'firebase-admin';

@Injectable()
export class FirebaseService implements OnModuleInit {
    private messaging: admin.messaging.Messaging;

    onModuleInit() {
        const raw = process.env.FIREBASE_SERVICE_ACCOUNT;

        if (!raw) {
            throw new Error('FIREBASE_SERVICE_ACCOUNT env variable is missing');
        }
        
        // const serviceAccount = JSON.parse(raw.replace(/\\n/g, '\n'));
        const serviceAccount = JSON.parse(raw);

        if (!admin.apps.length) {
            admin.initializeApp({
                credential: admin.credential.cert(serviceAccount as admin.ServiceAccount),
            });
        }

        this.messaging = admin.messaging();
    }

    async sendNotification(token: string, title: string, body: string, data: Record<string, string> = {}) {
        try {
            const message = {
                token,
                notification: { title, body },
                data,
            };

            return await this.messaging.send(message);
        } catch (err) {
            console.error('Failed to send FCM push:', err);
            throw err;
        }
    }
}