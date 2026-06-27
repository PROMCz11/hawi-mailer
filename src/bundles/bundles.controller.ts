import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  Res,
  Req,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Request, Response } from 'express';
import { join, resolve, sep } from 'path';
import { existsSync, renameSync } from 'fs';
import { ConfigService } from '@nestjs/config';
import { HeaderGuard } from 'src/auth/header/header.guard';
import { BundlesService } from './bundles.service';

@Controller('bundles')
export class BundlesController {
  constructor(
    private readonly bundlesService: BundlesService,
    private readonly configService: ConfigService,
  ) {}

  @Post('upload')
  @UseGuards(HeaderGuard)
  @UseInterceptors(FileInterceptor('file'))
  async uploadBundle(
    @UploadedFile() file: Express.Multer.File,
    @Body() body: { version: string; content?: string; force?: string },
  ) {
    if (!file) throw new BadRequestException('No file uploaded');
    if (!body.version?.trim()) throw new BadRequestException('Missing version');

    const bundlesDir = join(__dirname, '..', '..', 'uploads', 'bundles');
    const finalPath = join(bundlesDir, `${body.version}.zip`);

    renameSync(file.path, finalPath);

    const publicUrl = this.configService.getOrThrow<string>('PUBLIC_URL');
    const bundleUrl = `${publicUrl}/bundles/${body.version}.zip`;

    return this.bundlesService.publishVersion({
      version: body.version,
      bundleUrl,
      content: body.content,
      force: body.force,
    });
  }

  @Get(':filename')
  serveBundle(@Param('filename') filename: string, @Res() res: Response) {
    const bundlesDir = resolve(
      join(__dirname, '..', '..', 'uploads', 'bundles'),
    );
    const filePath = resolve(join(bundlesDir, filename));

    if (!filePath.startsWith(bundlesDir + sep)) {
      throw new BadRequestException('Invalid path');
    }

    if (!existsSync(filePath)) {
      throw new BadRequestException('Bundle not found');
    }

    res.sendFile(filePath);
  }
}
