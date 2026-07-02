import { ConfigService } from '@nestjs/config';
import { HeaderGuard } from './header.guard';

describe('HeaderGuard', () => {
  it('should be defined', () => {
    const configService = { get: () => 'test-token' } as unknown as ConfigService;
    expect(new HeaderGuard(configService)).toBeDefined();
  });
});
