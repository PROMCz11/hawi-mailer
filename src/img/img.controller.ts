import {
    Controller,
    Post,
    UploadedFile,
    UseInterceptors,
    UseGuards,
    Param,
    Get,
    Res,
    Query,
    BadRequestException,
    Req,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ImgService } from './img.service';
import { HeaderGuard } from 'src/auth/header/header.guard';
import { Request, Response } from 'express';
import { join, resolve, sep } from 'path';
import { existsSync, mkdirSync } from 'fs';

@Controller('img')
@UseGuards(HeaderGuard)
export class ImgController {
    constructor(private readonly imgService: ImgService) {}

    @Post('*')
    @UseInterceptors(FileInterceptor('file'))
    async uploadImage(
        @UploadedFile() file: Express.Multer.File,
        @Req() req: Request
    ) {
        if (!file) throw new BadRequestException('No file uploaded');

        let pathAfterImg = req.path.replace(/^\/?img\/?/, '').trim();

        if (!pathAfterImg) pathAfterImg = 'general';

        const rootUploadPath = join(__dirname, '..', '..', 'uploads');
        const safeUploadPath = resolve(join(rootUploadPath, pathAfterImg));

        if (!safeUploadPath.startsWith(rootUploadPath + sep)) {
            throw new BadRequestException('Invalid upload path');
        }

        if (!existsSync(safeUploadPath)) {
            mkdirSync(safeUploadPath, { recursive: true });
        }

        const { originalname, path: tempPath } = file;
        const extension = originalname.split('.').pop();
        const filename = `${Date.now()}-${Math.round(Math.random() * 1e9)}.${extension}`;
        const destinationPath = join(safeUploadPath, filename);

        const fs = await import('fs/promises'); 
        await fs.rename(tempPath, destinationPath);

        const publicUrl = `/img/${pathAfterImg}/${filename}`;
        return { url: publicUrl };
    }

    @Get('*')
    async getImageByPath(@Req() req: Request, @Res() res: Response) {
        const pathAfterImg = decodeURIComponent(req.path.replace(/^\/img\//, ''));
        const rootUploadPath = join(__dirname, '..', '..', 'uploads');

        const requestedPath = resolve(join(rootUploadPath, pathAfterImg));

        if (!requestedPath.startsWith(rootUploadPath + sep)) {
            throw new BadRequestException('Invalid image path');
        }

        if (!existsSync(requestedPath)) {
            throw new BadRequestException('File not found');
        }

        return res.sendFile(requestedPath);
    }
}