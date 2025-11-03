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
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ImgService } from './img.service';
import { HeaderGuard } from 'src/auth/header/header.guard';
import { Response } from 'express';
import { join } from 'path';
import { existsSync } from 'fs';

@Controller('img')
@UseGuards(HeaderGuard)
export class ImgController {
    constructor(private readonly imgService: ImgService) {}

    @Post()
    @UseInterceptors(FileInterceptor('file'))
    uploadImage(
        @UploadedFile() file: Express.Multer.File,
        @Query('subfolder') subfolder?: string
    ) {
        if (!file) throw new BadRequestException('No file uploaded');
        const folder = subfolder || 'general';
        return {
            url: `/img/${folder}/${file.filename}`,
        };
    }

    @Get(':folder/:filename')
    async getDeepImage(
        @Param('folder') folder: string,
        @Param('filename') filename: string,
        @Res() res: Response
    ) {
        const filePath = join(__dirname, '..', '..', 'uploads', folder, filename);

        if (!existsSync(filePath)) {
            throw new BadRequestException('File not found');
        }

        return res.sendFile(filePath);
    }

    @Get(':filename')
    async getImage(
        @Param('filename') filename: string,
        @Res() res: Response
    ) {
        const filePath = join(__dirname, '..', '..', 'uploads', filename);

        if (!existsSync(filePath)) {
            throw new BadRequestException('File not found');
        }

        return res.sendFile(filePath);
    }
}
