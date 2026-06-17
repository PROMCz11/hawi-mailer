import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class BundlesService {
  private supabase: SupabaseClient;

  constructor(private configService: ConfigService) {
    this.supabase = createClient(
      configService.getOrThrow<string>('SUPABASE_URL'),
      configService.getOrThrow<string>('SUPABASE_SERVICE_KEY'),
    );
  }

  async publishVersion(opts: {
    version: string;
    bundleUrl: string;
    content?: string;
    force?: string;
  }) {
    const { error } = await this.supabase.from('hawi_version').insert({
      version: opts.version,
      bundleUrl: opts.bundleUrl,
      content: opts.content ?? null,
      force: opts.force ?? null,
    });

    if (error) {
      throw new InternalServerErrorException(`Database insert failed: ${error.message}`);
    }

    return { version: opts.version, bundleUrl: opts.bundleUrl };
  }
}
