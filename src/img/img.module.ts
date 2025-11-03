import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { ImgController } from './img.controller';
import { ImgService } from './img.service';
import { diskStorage } from 'multer';
import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { ConfigModule } from '@nestjs/config';

const rootUploadPath = join(__dirname, '..', '..', 'uploads');

if (!existsSync(rootUploadPath)) {
    mkdirSync(rootUploadPath, { recursive: true });
}

@Module({
    imports: [
        MulterModule.register({
            storage: diskStorage({
                destination: (req, file, cb) => {
                    const subFolder = (req.query.subfolder as string) || 'general';
                    const uploadPath = join(rootUploadPath, subFolder);

                    if (!existsSync(uploadPath)) {
                        mkdirSync(uploadPath, { recursive: true });
                    }

                    cb(null, uploadPath);
                },
                filename: (req, file, cb) => {
                    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
                    const ext = file.originalname.split('.').pop();
                    cb(null, `${uniqueSuffix}.${ext}`);
                },
            }),
            limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB
            fileFilter: (req, file, cb) => {
                const allowed = ['image/jpeg', 'image/png', 'image/svg+xml'];
                if (allowed.includes(file.mimetype)) {
                    cb(null, true);
                } else {
                    cb(new Error('Only JPG, PNG, and SVG files are allowed'), false);
                }
            },
        }),
      ConfigModule
    ],
    controllers: [ImgController],
    providers: [ImgService],
})
export class ImgModule {}