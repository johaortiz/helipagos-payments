import { Controller, Get, Res } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { Public } from '../auth/decorators/public.decorator';

// Minimal structural type for @Res passthrough — avoids importing the express
// Response interface directly, which is a type-only export and not compatible
// with emitDecoratorMetadata in isolated-module mode.
interface HttpResponse {
  status(code: number): this;
}

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  @Get()
  @Public()
  @ApiOperation({ summary: 'Liveness check — returns basic uptime info' })
  @ApiResponse({ status: 200, description: 'Service is alive.' })
  liveness(): object {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      environment: process.env.NODE_ENV ?? 'development',
    };
  }

  @Get('ready')
  @Public()
  @ApiOperation({ summary: 'Readiness check — verifies database connectivity' })
  @ApiResponse({
    status: 200,
    description: 'Service is ready and database is reachable.',
  })
  @ApiResponse({ status: 503, description: 'Database is unreachable.' })
  async readiness(
    @Res({ passthrough: true }) res: HttpResponse,
  ): Promise<object> {
    try {
      await this.dataSource.query('SELECT 1');
      return {
        status: 'ready',
        database: 'up',
        timestamp: new Date().toISOString(),
      };
    } catch {
      res.status(503);
      return {
        status: 'not_ready',
        database: 'down',
        timestamp: new Date().toISOString(),
      };
    }
  }
}
