import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class BundlesService {
  private supabaseUrl: string;
  private supabaseKey: string;

  constructor(private configService: ConfigService) {
    this.supabaseUrl = configService.getOrThrow<string>('SUPABASE_URL');
    this.supabaseKey = configService.getOrThrow<string>('SUPABASE_SERVICE_KEY');
  }

  async publishVersion(opts: {
    version: string;
    bundleUrl: string;
    content?: string;
    force?: string;
  }) {
    const res = await fetch(`${this.supabaseUrl}/rest/v1/hawi_version`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': this.supabaseKey,
        'Authorization': `Bearer ${this.supabaseKey}`,
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify({
        version: opts.version,
        bundleUrl: opts.bundleUrl,
        content: opts.content ?? null,
        force: opts.force ?? null,
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => res.statusText);
      throw new InternalServerErrorException(`Database insert failed: ${detail}`);
    }

    return { version: opts.version, bundleUrl: opts.bundleUrl };
  }
}
