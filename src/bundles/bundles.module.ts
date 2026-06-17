import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { ConfigModule } from '@nestjs/config';
import { diskStorage } from 'multer';
import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { BundlesController } from './bundles.controller';
import { BundlesService } from './bundles.service';

const bundlesUploadPath = join(__dirname, '..', '..', 'uploads', 'bundles');

if (!existsSync(bundlesUploadPath)) {
  mkdirSync(bundlesUploadPath, { recursive: true });
}

@Module({
  imports: [
    ConfigModule,
    MulterModule.register({
      storage: diskStorage({
        destination: bundlesUploadPath,
        filename: (req, file, cb) => {
          cb(null, `tmp-${Date.now()}.zip`);
        },
      }),
      limits: { fileSize: 100 * 1024 * 1024 }, // 100 MB
      fileFilter: (req, file, cb) => {
        const isZip =
          file.mimetype === 'application/zip' ||
          file.mimetype === 'application/x-zip-compressed' ||
          file.mimetype === 'application/octet-stream' ||
          file.originalname.endsWith('.zip');
        if (isZip) {
          cb(null, true);
        } else {
          cb(new Error('Only ZIP files are allowed'), false);
        }
      },
    }),
  ],
  controllers: [BundlesController],
  providers: [BundlesService],
})
export class BundlesModule {}
